// Inbound side of the WhatsApp Cloud API: verifies Meta's webhook signature,
// turns customer messages into recordInbound() calls and applies delivery
// receipts (sent/delivered/read/failed) to stored outgoing messages.
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "./db";
import { recordInbound } from "./messaging";
import { HUB_API_TYPE, markRead } from "./whatsapp";

/** Checks X-Hub-Signature-256 (HMAC-SHA256 of the raw body with the app secret). */
export function verifySignature(rawBody: string, header: string | null) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody, "utf8").digest("hex"));
  const got = Buffer.from(header.slice("sha256=".length));
  return expected.length === got.length && timingSafeEqual(expected, got);
}

type WaMessage = {
  from: string;
  id: string;
  type: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string; filename?: string };
  location?: { name?: string; address?: string };
};

type WaStatus = { id: string; status: "sent" | "delivered" | "read" | "failed"; errors?: { code?: number; title?: string }[] };

type ChangeValue = {
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: WaMessage[];
  statuses?: WaStatus[];
};

export type WebhookPayload = { object?: string; entry?: { changes?: { field?: string; value?: ChangeValue }[] }[] };

/** Text shown in the inbox. Media is not downloaded yet, so it becomes a label (plus caption). */
function messageText(m: WaMessage) {
  const withCaption = (label: string, caption?: string) => (caption?.trim() ? `${label} ${caption.trim()}` : label);
  switch (m.type) {
    case "text": return m.text?.body?.trim() ?? "";
    case "button": return m.button?.text ?? "";
    case "interactive": return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "";
    case "image": return withCaption("[Gambar]", m.image?.caption);
    case "video": return withCaption("[Video]", m.video?.caption);
    case "document": return withCaption(`[Dokumen${m.document?.filename ? `: ${m.document.filename}` : ""}]`, m.document?.caption);
    case "audio": return "[Pesan suara]";
    case "sticker": return "[Stiker]";
    case "location": return `[Lokasi${m.location?.name ? `: ${m.location.name}` : ""}]`;
    case "contacts": return "[Kontak]";
    default: return ""; // reactions, system and unsupported types are ignored
  }
}

async function findDevice(phoneNumberId: string | undefined) {
  if (!phoneNumberId) return null;
  const exact = await db.device.findUnique({ where: { phoneNumberId } });
  if (exact) return exact;
  // Single-number setups configure the id only in .env: use the first Cloud API device.
  if (phoneNumberId === process.env.WHATSAPP_PHONE_NUMBER_ID) {
    return db.device.findFirst({ where: { apiType: { not: HUB_API_TYPE }, phoneNumberId: null }, orderBy: { id: "asc" } });
  }
  return null;
}

const RANK: Record<string, number> = { simulated: 0, sent: 1, delivered: 2, read: 3 };

async function applyStatus(s: WaStatus) {
  const msg = await db.message.findUnique({ where: { externalId: s.id } });
  if (!msg) return;
  if (s.status === "failed") {
    const err = s.errors?.[0];
    await db.message.update({ where: { id: msg.id }, data: { status: "failed" } });
    await db.message.create({
      data: {
        conversationId: msg.conversationId, direction: "out", sender: "system", status: "sent",
        text: `Pesan gagal terkirim${err?.title ? `: ${err.title}` : ""}${err?.code ? ` (kode ${err.code})` : ""}.`,
      },
    });
    return;
  }
  // Receipts arrive out of order and are processed concurrently, so the
  // "only move forward" rule is part of the UPDATE itself (read never -> delivered).
  const rank = RANK[s.status] ?? 0;
  const lower = Object.keys(RANK).filter((k) => RANK[k] < rank);
  await db.message.updateMany({ where: { id: msg.id, status: { in: lower } }, data: { status: s.status } });
}

/** Processes one webhook delivery. Errors are logged per item so one bad item can't block the rest. */
export async function handleWebhook(payload: WebhookPayload) {
  if (payload.object !== "whatsapp_business_account") return;
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages" || !change.value) continue;
      const v = change.value;
      const device = await findDevice(v.metadata?.phone_number_id);
      if (!device) {
        console.warn("[wa-cloud] webhook for an unregistered phone_number_id; set it on a device in WhatsApp Business > Cloud API");
        continue;
      }
      for (const s of v.statuses ?? []) {
        await applyStatus(s).catch((e) => console.error("[wa-cloud] status update failed:", (e as Error).message));
      }
      for (const m of v.messages ?? []) {
        const text = messageText(m);
        if (!text) continue;
        const name = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name;
        try {
          await markRead(m.id, device.phoneNumberId);
          await recordInbound({ phone: `+${m.from}`, name, text, deviceId: device.id, externalId: m.id });
        } catch (e) {
          console.error("[wa-cloud] inbound message failed:", (e as Error).message);
        }
      }
    }
  }
}
