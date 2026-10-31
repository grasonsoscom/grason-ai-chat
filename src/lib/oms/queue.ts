// Enqueue-only module. The worker lives in outbox.ts so that callers such as
// orders.ts can enqueue follow-up jobs without importing the worker.
import { Prisma } from "@prisma/client";
import { db } from "../db";

export type OmsJobKind = "create_lead" | "patch_lead" | "create_order" | "verify_order";

export type EnqueueOptions = {
  /** Unique key makes duplicate enqueues a no-op (e.g. one lead per conversation). */
  dedupeKey?: string;
  delayMs?: number;
};

export async function enqueueOmsJob(kind: OmsJobKind, payload: unknown, opts: EnqueueOptions = {}) {
  const data = {
    kind,
    payload: JSON.stringify(payload),
    dedupeKey: opts.dedupeKey ?? null,
    nextAttemptAt: new Date(Date.now() + (opts.delayMs ?? 0)),
  };
  try {
    return await db.omsOutbox.create({ data });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && opts.dedupeKey) {
      // A dead-lettered job is revived on re-enqueue (e.g. "Coba ulang");
      // pending/processing/done jobs make the enqueue a no-op.
      await db.omsOutbox.updateMany({
        where: { dedupeKey: opts.dedupeKey, status: "failed" },
        data: { status: "pending", attempts: 0, lastError: null, payload: data.payload, nextAttemptAt: data.nextAttemptAt },
      });
      const existing = await db.omsOutbox.findUnique({ where: { dedupeKey: opts.dedupeKey } });
      if (existing) return existing;
    }
    throw e;
  }
}

/**
 * Queues (another) send of a checkout. The key is unique per attempt because a
 * finished job (done after a definitive rejection) must not swallow a retry;
 * duplicate sends are harmless since the checkout keeps its external_id.
 */
export function enqueueCheckoutSend(checkoutId: number) {
  return enqueueOmsJob("create_order", { checkoutId }, { dedupeKey: `checkout:${checkoutId}:${Date.now()}` });
}

/** Retry delay after `attempts` failed tries: 2s, 4s, 8s, … capped at 1 hour. */
export function backoffMs(attempts: number) {
  return Math.min(2 ** Math.max(0, attempts) * 1000, 60 * 60 * 1000);
}
