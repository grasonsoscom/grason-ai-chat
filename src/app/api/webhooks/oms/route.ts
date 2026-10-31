import { Prisma } from "@prisma/client";
import { after } from "next/server";
import { db } from "@/lib/db";
import { processOutbox } from "@/lib/oms/outbox";
import { processStoredEvent, verifyOmsSignature } from "@/lib/oms/webhook";
import type { EventStatusOrder } from "@/lib/oms/types";

/**
 * OMS -> CS AI webhook (order.status_changed).
 * Must acknowledge 2xx within 10 seconds; heavy work runs in after().
 */
export async function POST(req: Request) {
  const secret = process.env.OMS_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[oms] OMS_WEBHOOK_SECRET is not set; rejecting webhook");
    return new Response("Not configured", { status: 500 });
  }

  const raw = await req.text(); // signature covers the raw body, before JSON parsing
  if (!verifyOmsSignature(raw, req.headers.get("x-oms-signature"), req.headers.get("x-oms-timestamp"), secret)) {
    return new Response("Invalid signature", { status: 400 });
  }

  let event: EventStatusOrder;
  try {
    event = JSON.parse(raw) as EventStatusOrder;
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  if (!event?.event_id || event.jenis !== "order.status_changed" || !event.data) {
    return new Response("Bad event", { status: 400 });
  }
  const occurred = new Date(event.terjadi_at);
  if (Number.isNaN(occurred.getTime())) return new Response("Bad event", { status: 400 });

  let stored;
  try {
    stored = await db.omsWebhookEvent.create({
      data: { eventId: event.event_id, jenis: event.jenis, terjadiAt: occurred, payload: raw },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return new Response("Duplicate", { status: 200 });
    }
    console.error("[oms] failed to store webhook event:", (e as Error).message);
    return new Response("Storage error", { status: 500 });
  }

  // processStoredEvent claims the row, so a concurrent cron retry of the same
  // event is skipped; failures stay on the row for the cron to retry.
  after(() =>
    processStoredEvent(stored)
      .then(() => processOutbox())
      .catch((e) => console.error("[oms] webhook processing failed:", (e as Error).message)),
  );

  return new Response("OK", { status: 200 });
}
