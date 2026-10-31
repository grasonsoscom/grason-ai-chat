"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { run, type ActionState } from "@/lib/action";
import { processOutbox } from "@/lib/oms/outbox";
import { processStoredEvent } from "@/lib/oms/webhook";

/** Gives a stuck OMS event a fresh set of attempts and processes it now. */
export async function requeueOmsEvent(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireAdmin();
    const id = Number(fd.get("eventId"));
    const reset = await db.omsWebhookEvent.updateMany({ where: { id, processedAt: null }, data: { attempts: 0 } });
    if (!reset.count) return "Event ini sudah diproses.";
    const row = await db.omsWebhookEvent.findUniqueOrThrow({ where: { id } });
    revalidatePath("/monitor-order");
    try {
      await processStoredEvent(row);
      return "Event berhasil diproses.";
    } catch (e) {
      throw new Error(`Event masih gagal: ${(e as Error).message}`);
    }
  });
}

/**
 * Re-runs a dead-lettered lead/verification/reminder job. Failed checkouts use
 * "Coba ulang" on the checkout instead, which keeps its external_id.
 */
export async function requeueOutboxJob(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireAdmin();
    const id = Number(fd.get("jobId"));
    const reset = await db.omsOutbox.updateMany({
      where: { id, status: "failed", kind: { not: "create_order" } },
      data: { status: "pending", attempts: 0, lastError: null, nextAttemptAt: new Date() },
    });
    if (!reset.count) return "Job ini sudah tidak dalam status gagal.";
    after(() => processOutbox().catch((e) => console.error("[oms] outbox kick failed:", (e as Error).message)));
    revalidatePath("/monitor-order");
    return "Job dijadwalkan ulang.";
  });
}
