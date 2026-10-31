// Pure HMAC verification, kept separate so it can be tested without DB imports.
import { createHmac, timingSafeEqual } from "crypto";

/** X-Oms-Signature = sha256=HMAC-SHA256(<timestamp>.<raw body>, OMS_WEBHOOK_SECRET). */
export function verifyOmsSignature(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  secret: string,
) {
  if (!secret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  if (!signature?.startsWith("sha256=")) return false;

  const expected = Buffer.from(
    `sha256=${createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex")}`,
  );
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
