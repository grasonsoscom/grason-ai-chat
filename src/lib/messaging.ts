import { db } from "./db";
import { alertAdmin } from "./alerts";
import { cancelAiReply, randomDelaySec, scheduleAiReply } from "./ai-delay";
import { sendTypingVia } from "./channel";
import { customerSegment } from "./promo";
import { generateReply, type ChatTurn } from "./ai";
import { assertCoins, spendCoins, COIN_COSTS } from "./coins";
import { insideServiceWindow } from "./whatsapp";
import { emitWebhook } from "./webhook";
import { addSystemNote, deliver, deliverTemplate } from "./outbound";
import { omsOnFirstResponse, omsOnFollowUp, omsOnHandover, omsOnInbound } from "./oms/lead";
import type { AttributionInput } from "./oms/lead-store";
import { getOmsCatalog } from "./oms/catalog";
import { omsConfigured } from "./oms/client";
import { isOrderLookup } from "./oms/customer-intents";
import { handleOrderChange } from "./oms/order-changes";
import { orderLookupContext } from "./oms/messages";
import {
  buildOrderContext,
  createAutoOrder,
  emptyOrderDraft,
  extractOrderDraft,
  isExplicitConfirmation,
  looksLikeOrder,
  planForConversation,
  type AiOrderDraft,
  type AutoOrderPlan,
} from "./ai-order";

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

/**
 * Stores an inbound customer message and lets the assigned AI agent respond.
 * `externalId` (WhatsApp wamid) makes redelivered webhooks a no-op.
 * `attribution` carries click-to-WhatsApp / landing-page ad IDs to the OMS lead.
 */
export async function recordInbound(input: {
  phone: string;
  name?: string;
  text: string;
  deviceId?: number | null;
  externalId?: string;
  attribution?: AttributionInput;
}) {
  if (input.externalId && (await db.message.findUnique({ where: { externalId: input.externalId } }))) {
    return { conversationId: null, ai: "duplicate" as const };
  }
  const phone = input.phone.trim();
  const existingCustomer = await db.customer.findUnique({ where: { phone }, select: { id: true } });
  const customer = await db.customer.upsert({
    where: { phone },
    update: {},
    create: { phone, name: input.name?.trim() || phone },
  });
  const deviceId = input.deviceId ?? (await db.device.findFirst({ orderBy: { id: "asc" } }))?.id ?? null;
  const now = new Date();
  const existingConversation = await db.conversation.findUnique({
    where: { customerId: customer.id },
    select: { id: true },
  });
  const conv = await db.conversation.upsert({
    where: { customerId: customer.id },
    update: { unread: { increment: 1 }, lastMessageAt: now, lastInboundAt: now },
    create: { customerId: customer.id, deviceId, unread: 1, lastMessageAt: now, lastInboundAt: now },
  });
  const message = await db.message.create({
    data: { conversationId: conv.id, direction: "in", sender: "customer", text: input.text, status: "read", externalId: input.externalId },
  });
  if (!existingCustomer) {
    await emitWebhook("contact.created", {
      contact: { id: customer.id, phone: customer.phone, name: customer.name },
    });
  }
  if (!existingConversation) {
    await emitWebhook("conversation.created", {
      conversation: { id: conv.id, customer_id: customer.id },
    });
  }
  await emitWebhook("message.received", {
    conversation_id: conv.id,
    message_id: message.id,
    customer_id: customer.id,
    direction: "in",
    sender: "customer",
    body: input.text,
  });
  await omsOnInbound(conv.id, input.attribution);

  if (conv.mode !== "ai") return { conversationId: conv.id, ai: "skipped" as const };

  // Agents with a reply delay answer later, like a person would; the sweeper
  // in ai-delay.ts sends it (one reply for all messages sent meanwhile).
  const agent = await findAgentForDevice(conv.deviceId);
  const delaySec = agent ? randomDelaySec(agent.replyDelayMinSec, agent.replyDelayMaxSec) : 0;
  if (delaySec > 0) {
    await scheduleAiReply(conv.id, delaySec);
    return { conversationId: conv.id, ai: "scheduled" as const };
  }
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
      await db.conversation.update({ where: { id: conversationId }, data: { mode: "eskalasi", modeChangedAt: new Date() } });
      await addSystemNote(conversationId, `Dieskalasi ke staf (kata kunci: "${hit}").`);
      await omsOnHandover(conversationId, `Percakapan dieskalasi (kata kunci: "${hit}")`);
      if (agent.escalationMessage.trim()) await deliver(conversationId, agent.escalationMessage.trim(), "ai");
      await emitWebhook("conversation.escalated", { conversation_id: conversationId, keyword: hit });
      return "escalated";
    }
  }

  // Cancel / address change on an open order: confirmed in chat, then sent to
  // OMS (cs-ai.v3); orders already at the warehouse go to staff.
  if (lastIn && omsConfigured()) {
    const lastAi = await db.message.findFirst({
      where: { conversationId, direction: "out", sender: "ai" },
      orderBy: { createdAt: "desc" },
      select: { text: true },
    });
    try {
      if (await handleOrderChange(conversationId, lastIn.text, lastAi?.text ?? "")) return "order_change";
    } catch (e) {
      await addSystemNote(conversationId, `Perubahan order lewat chat gagal diproses: ${(e as Error).message}`);
    }
  }

  try {
    await assertCoins(COIN_COSTS.aiReply);
    // "typing…" while the reply is generated, like a person answering.
    const device = conv.deviceId ? await db.device.findUnique({ where: { id: conv.deviceId } }) : null;
    await sendTypingVia(device, conv.customer.phone, lastIn?.externalId).catch(() => {});
    const turns = await history(conversationId);
    const segment = await customerSegment(conv.customerId);
    const lastAiText = [...turns].reverse().find((t) => t.role === "assistant")?.text ?? "";

    // AI order mode: extract the draft, price it, and prepare the reply context.
    let orderPlan: AutoOrderPlan | null = null;
    let orderDraft: AiOrderDraft = emptyOrderDraft();
    let orderContext = "";
    if (agent.autoOrder && omsConfigured()) {
      try {
        const catalog = await getOmsCatalog();
        const orderFlow =
          looksLikeOrder(lastIn?.text ?? "") ||
          /(pesanan|order|alamat|ongkir|nama|kota|kecamatan|kode pos|metode|bayar|konfirmasi|total)/i.test(lastAiText);
        if (catalog && orderFlow) {
          orderDraft = await extractOrderDraft(turns, catalog);
          orderDraft.confirmed =
            orderDraft.confirmed && isExplicitConfirmation(lastIn?.text ?? "", lastAiText);
          if (
            orderDraft.items.length ||
            orderDraft.nama ||
            orderDraft.alamat ||
            orderDraft.kota ||
            orderDraft.kecamatan ||
            orderDraft.metode_bayar ||
            orderDraft.intent !== "other"
          ) {
            orderPlan = await planForConversation(conversationId, orderDraft, catalog);
            orderContext = buildOrderContext(orderPlan, orderDraft.confirmed);
          }
        }
      } catch (e) {
        await addSystemNote(conversationId, `Perencanaan order otomatis gagal: ${(e as Error).message}`);
        orderPlan = null;
        orderContext = "";
      }
    }

    // "cek pesanan saya": answer from this conversation's orders only.
    let lookupContext = "";
    if (!orderContext && lastIn && isOrderLookup(lastIn.text)) {
      const orders = await db.omsOrder.findMany({ where: { conversationId }, orderBy: { createdAt: "desc" }, take: 3 });
      if (orders.length) lookupContext = orderLookupContext(orders);
    }

    const reply = await generateReply(agent.id, turns, undefined, segment, {
      extraContext: orderContext || lookupContext || undefined,
      skipShipping: Boolean(orderContext || lookupContext),
    });
    await spendCoins(COIN_COSTS.aiReply, `Balasan AI (${agent.name})`);
    const sent = await deliver(conversationId, reply, "ai");
    if (agent.webhookOnReply) {
      await emitWebhook("ai.replied", { conversation_id: conversationId, agent_id: agent.id, body: reply });
    }

    if (orderPlan?.ready && orderDraft.confirmed) {
      if (sent.status === "failed") {
        await addSystemNote(conversationId, "Order otomatis ditunda: balasan konfirmasi AI gagal dikirim ke pelanggan.");
      } else {
        try {
          const result = await createAutoOrder({ conversationId, plan: orderPlan });
          if (!result.ok) {
            // result.message is staff-facing (may name OMS/API errors): keep it
            // in a system note and send the customer a generic text.
            if (!result.noted) await addSystemNote(conversationId, `Order otomatis AI tidak dibuat: ${result.message}`);
            await deliver(
              conversationId,
              "Maaf, pesanan belum bisa dibuat otomatis. Staf kami akan membantu menyelesaikannya.",
              "ai",
            );
          }
        } catch (e) {
          await addSystemNote(conversationId, `Order otomatis gagal dibuat: ${(e as Error).message}`);
          await deliver(
            conversationId,
            "Maaf, pesanan belum bisa dibuat otomatis karena kendala sistem. Staf kami akan membantu menyelesaikannya.",
            "ai",
          );
        }
        return "order";
      }
    }
    return "replied";
  } catch (e) {
    await addSystemNote(conversationId, `AI tidak membalas: ${(e as Error).message}`);
    // e.g. coins used up or the AI provider down: every customer goes unanswered.
    await alertAdmin("ai-error", `AI berhenti membalas pelanggan: ${(e as Error).message}`);
    return "error";
  }
}

/** Staff reply. Free text is only allowed inside the 24h customer service window. */
export async function sendStaffMessage(conversationId: number, text: string) {
  const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversationId } });
  if (!insideServiceWindow(conv.lastInboundAt)) {
    throw new Error("Di luar jendela 24 jam. Kirim pesan template untuk memulai ulang percakapan.");
  }
  // A manual reply answers the customer; a delayed AI reply on top would be odd.
  await cancelAiReply(conversationId);
  const result = await deliver(conversationId, text, "staff");
  if (result.status === "failed") throw new Error(result.error ?? "Pesan gagal terkirim.");
}

export async function sendTemplateMessage(conversationId: number, templateId: number) {
  const result = await deliverTemplate(conversationId, templateId);
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
      await omsOnFollowUp(c.id);
      sent++;
    }
  }
  return sent;
}
