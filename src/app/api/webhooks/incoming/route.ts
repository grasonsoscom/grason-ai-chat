import { timingSafeEqual } from "crypto";
import { recordInbound } from "@/lib/messaging";

function authorized(req: Request) {
  const expected = process.env.INCOMING_WEBHOOK_SECRET;
  const got = req.headers.get("x-webhook-secret") ?? "";
  if (!expected) return false;
  const a = Buffer.from(expected), b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Receives an inbound customer message from an external system. */
export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let body: { phone?: unknown; name?: unknown; text?: unknown; deviceId?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body harus JSON" }, { status: 400 });
  }
  const phone = typeof body.phone === "string" ? body.phone.replace(/[\s-]/g, "") : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!/^\+?\d{8,15}$/.test(phone) || !text) {
    return Response.json({ error: "phone (format internasional) dan text wajib diisi" }, { status: 400 });
  }
  const result = await recordInbound({
    phone, text,
    name: typeof body.name === "string" ? body.name : undefined,
    deviceId: typeof body.deviceId === "number" ? body.deviceId : null,
  });
  return Response.json(result);
}
