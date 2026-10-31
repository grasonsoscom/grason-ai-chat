// OMS -> CS AI webhook: signature verification and event processing.
// The route must verify the raw body before parsing JSON.
import { db } from "../db";
import { getOrder } from "./client";
import { applyStatusEvent, orderRowData } from "./orders";
import type { EventStatusOrder } from "./types";

export { verifyOmsSignature } from "./signature";

const MAX_EVENT_ATTEMPTS = 5;

/**
 * Finds the local order mirror for an event. An event can arrive before the
 * checkout response was stored (timeout, outbox retry): when the event names
 * a checkout we know, the order is fetched from OMS and the mirror created.
 */
async function findOrCreateMirror(event: EventStatusOrder) {
  const found = await db.omsOrder.findFirst({
    where: { OR: [{ omsOrderId: event.data.order_id }, { nomor: event.data.nomor }] },
    select: { id: true },
  });
  if (found) return found;

  const externalId = event.data.checkout_external_id;
  const checkout = externalId
    ? await db.omsCheckout.findUnique({ where: { externalId }, select: { id: true, conversationId: true } })
    : null;
  if (!checkout) return null;

  const order = await getOrder(event.data.order_id);
  const data = orderRowData(order, checkout.id, checkout.conversationId);
  return db.omsOrder.upsert({
    where: { omsOrderId: order.id },
    update: {},
    create: data,
    select: { id: true },
  });
}

export async function processOmsEvent(event: EventStatusOrder) {
  if (!event?.data) throw new Error("Payload event tidak valid.");
  const order = await findOrCreateMirror(event);
  if (!order) throw new Error(`Order OMS ${event.data.order_id} (${event.data.nomor}) tidak ditemukan.`);
  return applyStatusEvent(order.id, event, { source: "webhook" });
}

/**
 * Processes one stored event at most once at a time: the attempts counter is
 * a compare-and-set claim, so the webhook's after() and the cron retry cannot
 * both pick up the same attempt. Re-processing after a crash is safe because
 * applyStatusEvent is idempotent.
 */
export async function processStoredEvent(row: { id: number; attempts: number; payload: string }) {
  const claimed = await db.omsWebhookEvent.updateMany({
    where: { id: row.id, processedAt: null, attempts: row.attempts },
    data: { attempts: { increment: 1 } },
  });
  if (!claimed.count) return false;

  try {
    const event = JSON.parse(row.payload) as EventStatusOrder;
    if (event.jenis !== "order.status_changed") throw new Error("Jenis event tidak dikenal.");
    await processOmsEvent(event);
    await db.omsWebhookEvent.update({
      where: { id: row.id },
      data: { processedAt: new Date(), lastError: null },
    });
    return true;
  } catch (e) {
    const message = (e as Error).message.slice(0, 1000);
    await db.omsWebhookEvent.update({ where: { id: row.id }, data: { lastError: message } }).catch(() => {});
    if (row.attempts + 1 >= MAX_EVENT_ATTEMPTS) {
      console.error(`[oms] webhook event ${row.id} abandoned after ${MAX_EVENT_ATTEMPTS} attempts: ${message}`);
    }
    throw e;
  }
}

/** Retries events that were acknowledged but failed to process (cron). */
export async function processPendingOmsEvents(limit = 20) {
  const rows = await db.omsWebhookEvent.findMany({
    where: { processedAt: null, attempts: { lt: MAX_EVENT_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let processed = 0;
  for (const row of rows) {
    try {
      if (await processStoredEvent(row)) processed++;
    } catch {
      // Error is stored on the row; the next cron run retries it.
    }
  }
  return processed;
}
