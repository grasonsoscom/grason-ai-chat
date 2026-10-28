import { db } from "./db";
import { generateReply, type ChatTurn } from "./ai";
import { assertCoins, spendCoins, COIN_COSTS } from "./coins";
import { sendTemplateVia, sendTextVia } from "./channel";
import { insideServiceWindow } from "./whatsapp";
import { emitWebhook } from "./webhook";

async function findAgentForDevice(deviceId: number | null) {
  if (deviceId) {
    const agent = await db.aiAgent.findFirst({ where: { active: true, devices: { some: { id: deviceId } } } });
    if (agent) return agent;
  }
  return null;
}

async function history(conversationId: number): Promise<ChatTurn[]> {
  const msgs = await db.message.findMany({
    where: { conversationId, sender: { not: "system" } },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return msgs.reverse().map((m) => ({ role: m.direction === "in" ? "user" : "assistant", text: m.text }));
}

async function addSystemNote(conversationId: number, text: string) {
  await db.message.create({ data: { conversationId, direction: "out", sender: "system", text, status: "sent" } });
}

/**
 * Stores an inbound customer message and lets the assigned AI agent respond.
 * `externalId` (WhatsApp wamid) makes redelivered webhooks a no-op.
 */
export async function recordInbound(input: { phone: string; name?: string; text: string; deviceId?: number | null; externalId?: string }) {
  if (input.externalId && (await db.message.findUnique({ where: { externalId: input.externalId } }))) {
    return { conversationId: null, ai: "duplicate" as const };
  }
  const phone = input.phone.trim();
  const customer = await db.customer.upsert({
    where: { phone },
    update: {},
    create: { phone, name: input.name?.trim() || phone },
  });
  const deviceId = input.deviceId ?? (await db.device.findFirst({ orderBy: { id: "asc" } }))?.id ?? null;
  const now = new Date();
  const conv = await db.conversation.upsert({
    where: { customerId: customer.id },
    update: { unread: { increment: 1 }, lastMessageAt: now, lastInboundAt: now },
    create: { customerId: customer.id, deviceId, unread: 1, lastMessageAt: now, lastInboundAt: now },
  });
  await db.message.create({
    data: { conversationId: conv.id, direction: "in", sender: "customer", text: input.text, status: "read", externalId: input.externalId },
  });
  await emitWebhook("message.received", { conversationId: conv.id, customerId: customer.id, text: input.text });

  if (conv.mode !== "ai") return { conversationId: conv.id, ai: "skipped" as const };
  return { conversationId: conv.id, ai: await aiRespond(conv.id) };
}

/** Runs the AI agent on a conversation. Returns a status string; never throws. */
export async function aiRespond(conversationId: number): Promise<string> {
  const conv = await db.conversation.findUnique({ where: { id: conversationId }, include: { customer: true } });
  if (!conv) return "not_found";
  const agent = await findAgentForDevice(conv.deviceId);
  if (!agent) return "no_agent";

  const lastIn = await db.message.findFirst({
    where: { conversationId, direction: "in" },
    orderBy: { createdAt: "desc" },
  });
  if (agent.escalationEnabled && lastIn) {
    const keywords = agent.escalationKeywords.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean);
    const hit = keywords.find((k) => lastIn.text.toLowerCase().includes(k));
    if (hit) {
      await db.conversation.update({ where: { id: conversationId }, data: { mode: "eskalasi" } });
      await addSystemNote(conversationId, `Dieskalasi ke staf (kata kunci: "${hit}").`);
      if (agent.escalationMessage.trim()) await deliver(conversationId, agent.escalationMessage.trim(), "ai");
      await emitWebhook("conversation.escalated", { conversationId, keyword: hit });
      return "escalated";
    }
  }

  try {
    await assertCoins(COIN_COSTS.aiReply);
    const reply = await generateReply(agent.id, await history(conversationId));
    await spendCoins(COIN_COSTS.aiReply, `Balasan AI (${agent.name})`);
    await deliver(conversationId, reply, "ai");
    if (agent.webhookOnReply) await emitWebhook("ai.replied", { conversationId, agentId: agent.id, text: reply });
    return "replied";
  } catch (e) {
    await addSystemNote(conversationId, `AI tidak membalas: ${(e as Error).message}`);
    return "error";
  }
}

async function deliver(conversationId: number, text: string, sender: "ai" | "staff") {
  const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversationId }, include: { customer: true, device: true } });
  const result = await sendTextVia(conv.device, conv.customer.phone, text);
  await db.message.create({
    data: { conversationId, direction: "out", sender, text, status: result.status, externalId: result.externalId },
  });
  await db.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });
  await emitWebhook("message.sent", { conversationId, sender, text, status: result.status });
  return result;
}

/** Staff reply. Free text is only allowed inside the 24h customer service window. */
export async function sendStaffMessage(conversationId: number, text: string) {
  const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversationId } });
  if (!insideServiceWindow(conv.lastInboundAt)) {
    throw new Error("Di luar jendela 24 jam. Kirim pesan template untuk memulai ulang percakapan.");
  }
  const result = await deliver(conversationId, text, "staff");
  if (result.status === "failed") throw new Error(result.error ?? "Pesan gagal terkirim.");
}

export async function sendTemplateMessage(conversationId: number, templateId: number) {
  const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversationId }, include: { customer: true, device: true } });
  const tpl = await db.messageTemplate.findUniqueOrThrow({ where: { id: templateId } });
  const result = await sendTemplateVia(conv.device, conv.customer.phone, tpl);
  await db.message.create({
    data: { conversationId, direction: "out", sender: "staff", text: `[Template: ${tpl.name}] ${tpl.body}`, status: result.status, externalId: result.externalId },
  });
  await db.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });
  if (result.status === "failed") throw new Error(result.error ?? "Template gagal terkirim.");
}

/**
 * Sends one follow-up per silence period for agents with Auto-Followup on.
 * Skips conversations outside the 24h window (template needed there).
 */
export async function runFollowups() {
  const agents = await db.aiAgent.findMany({ where: { active: true, followupEnabled: true }, include: { devices: true } });
  let sent = 0;
  for (const agent of agents) {
    if (!agent.followupMessage.trim()) continue;
    const cutoff = new Date(Date.now() - agent.followupDelayHours * 3600 * 1000);
    const convs = await db.conversation.findMany({
      where: { mode: "ai", deviceId: { in: agent.devices.map((d) => d.id) }, lastMessageAt: { lt: cutoff } },
      include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    for (const c of convs) {
      const last = c.messages[0];
      if (!last || last.direction !== "out") continue;
      if (c.lastFollowupAt && c.lastInboundAt && c.lastFollowupAt > c.lastInboundAt) continue;
      if (!insideServiceWindow(c.lastInboundAt)) continue;
      await deliver(c.id, agent.followupMessage.trim(), "ai");
      await db.conversation.update({ where: { id: c.id }, data: { lastFollowupAt: new Date() } });
      sent++;
    }
  }
  return sent;
}
