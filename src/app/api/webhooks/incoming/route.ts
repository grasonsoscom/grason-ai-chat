import { timingSafeEqual } from "crypto";
import { after } from "next/server";
import { recordInbound } from "@/lib/messaging";
import { processOutbox } from "@/lib/oms/outbox";

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
  let body: {
    phone?: unknown;
    name?: unknown;
    text?: unknown;
    deviceId?: unknown;
    kanal?: unknown;
    campaign_id?: unknown;
    adset_id?: unknown;
    ad_id?: unknown;
  };
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

  const attribution = {
    kanal: typeof body.kanal === "string" ? body.kanal : undefined,
    campaign_id: typeof body.campaign_id === "string" ? body.campaign_id : null,
    adset_id: typeof body.adset_id === "string" ? body.adset_id : null,
    ad_id: typeof body.ad_id === "string" ? body.ad_id : null,
  };
  const hasAttribution = Boolean(
    attribution.kanal || attribution.campaign_id || attribution.adset_id || attribution.ad_id,
  );

  const result = await recordInbound({
    phone,
    text,
    name: typeof body.name === "string" ? body.name : undefined,
    deviceId: typeof body.deviceId === "number" ? body.deviceId : null,
    attribution: hasAttribution ? attribution : undefined,
  });
  after(() => processOutbox().catch((e) => console.error("[oms] outbox kick failed:", (e as Error).message)));
  return Response.json(result);
}
