import { timingSafeEqual } from "node:crypto";
import { alertAdmin, cleanRecipients, MAX_ALERT_RECIPIENTS } from "@/lib/alerts";

function sameSecret(given: string | null, expected: string) {
  const a = Buffer.from(given ?? "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Alerts from the VPS watchdog (deploy/grason-watchdog.sh) and TikTok Studio.
 * POST with x-webhook-secret and { key, text, to? }. `to` (optional) is the
 * sender's own list of WhatsApp numbers (max 10); without it the alert goes to
 * ALERT_WHATSAPP.
 */
export async function POST(req: Request) {
  const secret = process.env.INCOMING_WEBHOOK_SECRET;
  if (!secret || !sameSecret(req.headers.get("x-webhook-secret"), secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { key?: unknown; text?: unknown; to?: unknown };
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 1000) : "";
  if (!text) return Response.json({ error: "text wajib diisi." }, { status: 400 });
  let to: string[] = [];
  if (body.to !== undefined) {
    if (!Array.isArray(body.to) || body.to.length > MAX_ALERT_RECIPIENTS) {
      return Response.json({ error: `to harus daftar maks. ${MAX_ALERT_RECIPIENTS} nomor.` }, { status: 400 });
    }
    to = cleanRecipients(body.to);
    if (body.to.length && !to.length) return Response.json({ error: "Tidak ada nomor WhatsApp yang valid (format 62…)." }, { status: 400 });
  }
  const key = typeof body.key === "string" && body.key ? `watchdog:${body.key.slice(0, 50)}` : "watchdog";
  // The senders throttle themselves; send every alert they ask for.
  const sent = await alertAdmin(key, text, 0, undefined, to);
  return Response.json({ ok: true, sent });
}
