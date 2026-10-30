import { verifyOmsSignature, type OrderStatusEvent } from "@/lib/oms";
import { handleOmsEvent } from "@/lib/oms-sync";

/**
 * OMS GRASON webhook (order.status_changed). OMS treats 400 as final and retries
 * anything else that is not 2xx within 10 seconds, so a bad signature gets 400.
 */
export async function POST(req: Request) {
  const raw = await req.text(); // raw body: the signature covers it byte for byte
  const secret = process.env.OMS_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[oms] OMS_WEBHOOK_SECRET is not set; rejecting webhook");
    return Response.json({ error: "Webhook OMS belum dikonfigurasi" }, { status: 500 });
  }
  if (!verifyOmsSignature(secret, req.headers.get("x-oms-timestamp"), raw, req.headers.get("x-oms-signature"))) {
    return Response.json({ error: "Tanda tangan tidak valid" }, { status: 400 });
  }
  let event: OrderStatusEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Body harus JSON" }, { status: 400 });
  }
  if (event?.jenis !== "order.status_changed") return Response.json({ ok: true, ignored: true });
  if (!event.event_id || !event.terjadi_at || !event.data?.order_id || !event.data.status) {
    return Response.json({ error: "Payload tidak lengkap" }, { status: 400 });
  }
  const result = await handleOmsEvent(event);
  return Response.json({ ok: true, ...(result === "duplicate" ? { duplicate: true } : {}) });
}
