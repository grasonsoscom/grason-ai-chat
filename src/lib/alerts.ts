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
 * Sends one alert to every admin number. The same `key` is sent at most once
 * per `throttleMs` so a burst of failures becomes one message. Never throws.
 */
export async function alertAdmin(key: string, text: string, throttleMs = DEFAULT_THROTTLE_MS) {
  const to = alertRecipients();
  if (!to.length || !shouldAlert(key, throttleMs)) return;
  try {
    const device = await alertDevice();
    const body = `⚠️ GrasOn AI Chat\n${text}`;
    for (const phone of to) {
      const result = await sendTextVia(device, phone, body);
      if (result.status === "failed") console.error(`[alert] to admin failed: ${result.error ?? "unknown"}`);
    }
  } catch (e) {
    console.error("[alert] failed:", (e as Error).message);
  }
}
