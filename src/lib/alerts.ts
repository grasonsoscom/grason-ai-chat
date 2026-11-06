// WhatsApp alerts to the admin when something needs attention (OMS orders
// failing, AI not replying, the app restarted by the watchdog).
//
// ALERT_WHATSAPP: comma-separated admin numbers (empty = alerts off).
// ALERT_DEVICE_ID (optional): device to send from. Default: a connected
// WhatsApp Hub device (no 24h window), else the first Cloud API device, whose
// free-form text only reaches an admin who messaged that number in the last 24h.
import { db } from "./db";
import { sendTextVia } from "./channel";
import { HUB_API_TYPE } from "./whatsapp";

const DEFAULT_THROTTLE_MS = 30 * 60_000;
const lastSent = new Map<string, number>();

export function alertRecipients() {
  return (process.env.ALERT_WHATSAPP ?? "")
    .split(",")
    .map((n) => n.replace(/\D/g, ""))
    .filter((n) => n.length >= 9);
}

/** Most numbers one alert may go to when a sender (e.g. TikTok Studio) names its own recipients. */
export const MAX_ALERT_RECIPIENTS = 10;

/**
 * Indonesian WhatsApp numbers from a sender's own list: "0812…", "812…", "+62 812-…" → "62812…".
 * Anything else is dropped; duplicates removed; at most MAX_ALERT_RECIPIENTS.
 */
export function cleanRecipients(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const raw of list) {
    let n = String(raw ?? "").replace(/\D/g, "");
    if (n.startsWith("0")) n = `62${n.slice(1)}`;
    else if (n.startsWith("8")) n = `62${n}`;
    if (/^628\d{7,12}$/.test(n) && !out.includes(n)) out.push(n);
    if (out.length >= MAX_ALERT_RECIPIENTS) break;
  }
  return out;
}

/** True when this key may alert now; records the send time. Per process. */
export function shouldAlert(key: string, throttleMs = DEFAULT_THROTTLE_MS, now = Date.now()) {
  const last = lastSent.get(key);
  if (last !== undefined && now - last < throttleMs) return false;
  lastSent.set(key, now);
  return true;
}

async function alertDevice() {
  const id = Number(process.env.ALERT_DEVICE_ID);
  if (id > 0) return db.device.findUnique({ where: { id } });
  return (
    (await db.device.findFirst({ where: { apiType: HUB_API_TYPE, status: "connected" }, orderBy: { id: "asc" } })) ??
    (await db.device.findFirst({ where: { apiType: { not: HUB_API_TYPE } }, orderBy: { id: "asc" } }))
  );
}

/**
 * Sends one alert to every admin number, or to `recipients` when the sender
 * names its own (already cleaned). The same `key` is sent at most once per
 * `throttleMs` so a burst of failures becomes one message. Never throws.
 * Returns how many numbers it went to.
 */
export async function alertAdmin(
  key: string,
  text: string,
  throttleMs = DEFAULT_THROTTLE_MS,
  title = "⚠️ GrasOn AI Chat",
  recipients: string[] = [],
): Promise<number> {
  const to = recipients.length ? recipients : alertRecipients();
  if (!to.length || !shouldAlert(key, throttleMs)) return 0;
  let sent = 0;
  try {
    const device = await alertDevice();
    const body = `${title}\n${text}`;
    for (const phone of to) {
      const result = await sendTextVia(device, phone, body);
      if (result.status === "failed") console.error(`[alert] to ${phone.slice(0, 5)}… failed: ${result.error ?? "unknown"}`);
      else sent += 1;
    }
  } catch (e) {
    console.error("[alert] failed:", (e as Error).message);
  }
  return sent;
}
