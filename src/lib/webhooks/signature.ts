// Outbound webhook signing, mirroring the WhatsMax-style convention:
// X-Webhook-Signature: t=<unix>,v1=<HMAC-SHA256(t + "." + rawBody, secret)>
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("hex")}`;
}

export function signWebhook(secret: string, timestamp: number, rawBody: string): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

export function verifyWebhookSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  toleranceSeconds = 300,
  now = Math.floor(Date.now() / 1000),
): boolean {
  if (!secret || !header) return false;

  let timestamp: number | null = null;
  let received: string | null = null;
  for (const part of header.split(",")) {
    const [key, value] = part.split("=");
    if (key?.trim() === "t") timestamp = Number(value);
    if (key?.trim() === "v1") received = value?.trim() ?? null;
  }
  if (timestamp === null || !Number.isFinite(timestamp) || !received) return false;
  if (Math.abs(now - timestamp) > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}
