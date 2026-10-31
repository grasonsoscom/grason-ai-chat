// OMS -> CS AI webhook: signature verification and event processing.
// The route must verify the raw body before parsing JSON.
import { db } from "../db";
import { applyStatusEvent } from "./orders";
import type { EventStatusOrder } from "./types";

export { verifyOmsSignature } from "./signature";

export async function processOmsEvent(event: EventStatusOrder) {
  if (!event?.data) throw new Error("Payload event tidak valid.");
  const order = await db.omsOrder.findFirst({
    where: { OR: [{ omsOrderId: event.data.order_id }, { nomor: event.data.nomor }] },
    select: { id: true },
  });
  if (!order) throw new Error(`Order OMS ${event.data.order_id} (${event.data.nomor}) tidak ditemukan.`);
  return applyStatusEvent(order.id, event);
}

/** Retries events that were acknowledged but failed to process (cron). */
export async function processPendingOmsEvents(limit = 20) {
  const rows = await db.omsWebhookEvent.findMany({
    where: { processedAt: null, attempts: { lt: 5 } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let processed = 0;
  for (const row of rows) {
    try {
      const event = JSON.parse(row.payload) as EventStatusOrder;
      if (event.jenis !== "order.status_changed") throw new Error("Jenis event tidak dikenal.");
      await processOmsEvent(event);
      await db.omsWebhookEvent.update({
        where: { id: row.id },
        data: { processedAt: new Date(), lastError: null },
      });
      processed++;
    } catch (e) {
      await db.omsWebhookEvent.update({
        where: { id: row.id },
        data: { attempts: { increment: 1 }, lastError: (e as Error).message.slice(0, 1000) },
      });
    }
  }
  return processed;
}
