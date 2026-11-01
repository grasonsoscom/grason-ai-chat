import { alertAdmin, alertRecipients } from "@/lib/alerts";
import { verifyOmsSignature } from "@/lib/oms/signature";

/**
 * OMS -> CRM admin alert (contract alert.v1 in the OMS repo). Signed like the OMS
 * webhooks (X-Oms-Signature over "<timestamp>.<raw body>", OMS_WEBHOOK_SECRET).
 * The OMS decides when to alert; this only delivers to ALERT_WHATSAPP.
 */
export async function POST(req: Request) {
  const secret = process.env.OMS_WEBHOOK_SECRET;
  if (!secret) return new Response("Not configured", { status: 500 });

  const raw = await req.text();
  if (!verifyOmsSignature(raw, req.headers.get("x-oms-signature"), req.headers.get("x-oms-timestamp"), secret)) {
    return new Response("Invalid signature", { status: 400 });
  }
  let body: { kunci?: unknown; judul?: unknown; teks?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const kunci = typeof body.kunci === "string" ? body.kunci.slice(0, 100) : "";
  const teks = typeof body.teks === "string" ? body.teks.slice(0, 3000) : "";
  const judul = typeof body.judul === "string" && body.judul.trim() ? body.judul.slice(0, 80) : "📦 OMS GrasOn";
  if (!kunci || !teks) return new Response("Bad alert", { status: 400 });

  // The OMS already throttles per condition; a short guard only absorbs retries.
  await alertAdmin(`oms:${kunci}`, teks, 60_000, judul);
  return Response.json({ terkirim: alertRecipients().length > 0 });
}
