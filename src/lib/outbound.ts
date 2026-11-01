// Shared outbound helpers used by messaging and the OMS integration.
// Kept separate from messaging.ts so OMS modules can send messages without
// creating an import cycle.
import { db } from "./db";
import { sendMediaVia, sendTemplateVia, sendTextVia } from "./channel";
import { KIND_LABEL, readMedia, type MediaKind } from "./media";
import { emitWebhook } from "./webhook";
import { insideServiceWindow } from "./whatsapp";
import { omsOnFirstResponse } from "./oms/lead";

export type OutboundResult = {
  status: "sent" | "simulated" | "failed";
  error?: string;
  externalId?: string;
  messageId?: number;
};

export async function addSystemNote(conversationId: number, text: string) {
  await db.message.create({
    data: { conversationId, direction: "out", sender: "system", text, status: "sent" },
  });
}

export async function deliver(
  conversationId: number,
  text: string,
  sender: "ai" | "staff",
): Promise<OutboundResult> {
  const conv = await db.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: { customer: true, device: true },
  });
  const result = await sendTextVia(conv.device, conv.customer.phone, text);
  const message = await db.message.create({
    data: { conversationId, direction: "out", sender, text, status: result.status, externalId: result.externalId },
  });
  await db.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });
  await emitWebhook("message.sent", {
    conversation_id: conversationId,
    message_id: message.id,
    sender,
    body: text,
    status: result.status,
  });
  await omsOnFirstResponse(conversationId);
  return { ...result, messageId: message.id };
}

/**
 * Sends a photo/video from the media library and logs it. The message text is a
 * short label ("[Foto: …]") so history, search, and the AI see what was sent.
 */
export async function deliverMedia(
  conversationId: number,
  mediaAssetId: number,
  sender: "ai" | "staff",
): Promise<OutboundResult> {
  const conv = await db.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: { customer: true, device: true },
  });
  const asset = await db.mediaAsset.findUniqueOrThrow({ where: { id: mediaAssetId } });
  const label = `[${KIND_LABEL[asset.kind as MediaKind] ?? "Media"}: ${asset.title}]${asset.caption.trim() ? ` ${asset.caption.trim()}` : ""}`;
  let result: Awaited<ReturnType<typeof sendMediaVia>>;
  try {
    const data = await readMedia(asset.fileName);
    result = await sendMediaVia(conv.device, conv.customer.phone, {
      kind: asset.kind as MediaKind,
      data,
      mimeType: asset.mimeType,
      fileName: `${asset.kind === "video" ? "video" : "foto"}${asset.mimeType === "video/mp4" ? ".mp4" : asset.mimeType === "image/png" ? ".png" : ".jpg"}`,
      caption: asset.caption,
    });
  } catch {
    result = { status: "failed", error: "File media tidak ditemukan di server." };
  }
  const message = await db.message.create({
    data: {
      conversationId,
      direction: "out",
      sender,
      text: label,
      status: result.status,
      externalId: result.externalId,
      mediaAssetId: asset.id,
    },
  });
  await db.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });
  await emitWebhook("message.sent", {
    conversation_id: conversationId,
    message_id: message.id,
    sender,
    body: label,
    media: { id: asset.id, kind: asset.kind, title: asset.title },
    status: result.status,
  });
  await omsOnFirstResponse(conversationId);
  return { ...result, messageId: message.id };
}

/** Sends a stored template (Meta template on Cloud API, plain text on Hub) and logs it. */
export async function deliverTemplate(conversationId: number, templateId: number): Promise<OutboundResult> {
  const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversationId }, include: { customer: true, device: true } });
  const tpl = await db.messageTemplate.findUniqueOrThrow({ where: { id: templateId } });
  const text = `[Template: ${tpl.name}] ${tpl.body}`;
  const result = await sendTemplateVia(conv.device, conv.customer.phone, tpl);
  const message = await db.message.create({
    data: { conversationId, direction: "out", sender: "staff", text, status: result.status, externalId: result.externalId },
  });
  await db.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });
  await emitWebhook("message.sent", {
    conversation_id: conversationId,
    message_id: message.id,
    sender: "staff",
    body: text,
    status: result.status,
  });
  await omsOnFirstResponse(conversationId);
  return { ...result, messageId: message.id };
}

/**
 * Automated OMS follow-up. Free-form text is only allowed inside the 24h
 * window; outside it, the message is kept as a staff note instead.
 */
export async function deliverAutomated(conversationId: number, text: string) {
  const conv = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { lastInboundAt: true },
  });
  if (!conv) return { status: "failed" as const, error: "Percakapan tidak ditemukan." };
  if (!insideServiceWindow(conv.lastInboundAt)) {
    await addSystemNote(conversationId, `Di luar jendela 24 jam; pesan otomatis tidak dikirim ke pembeli: ${text}`);
    return { status: "skipped" as const };
  }
  return deliver(conversationId, text, "staff");
}
