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
      const existing = await db.omsOutbox.findUnique({ where: { dedupeKey: opts.dedupeKey } });
      if (existing) return existing;
    }
    throw e;
  }
}

/** Retry delay after `attempts` failed tries: 2s, 4s, 8s, … capped at 1 hour. */
export function backoffMs(attempts: number) {
  return Math.min(2 ** Math.max(0, attempts) * 1000, 60 * 60 * 1000);
}
