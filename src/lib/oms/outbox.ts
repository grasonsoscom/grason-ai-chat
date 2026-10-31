// Durable worker for OMS writes. The webhook routes and cron call this; server
// actions can also kick it with after(). A failed job never loses customer data.
import { db } from "../db";
import { addSystemNote } from "../outbound";
import { friendlyOmsError } from "./errors";
import { OmsApiError, OmsNetworkError, getLead, updateLead } from "./client";
import { ensureLeadId, storeLeadSnapshot } from "./lead-store";
import { submitCheckout, autoVerifyCheckout, submitVerification } from "./orders";
import { backoffMs, enqueueOmsJob, type OmsJobKind } from "./queue";
import type { UbahLead, Verifikasi } from "./types";

const MAX_ATTEMPTS = 12;
const STUCK_MS = 5 * 60 * 1000;

type LeadJob = { conversationId: number; patch?: UbahLead };
type CheckoutJob = { checkoutId: number };
type VerifyJob = { orderId: number; input: Verifikasi };

function parsePayload<T>(payload: string): T {
  return JSON.parse(payload) as T;
}

export async function processOutbox(limit = 20) {
  const now = new Date();
  const rows = await db.omsOutbox.findMany({
    where: { status: { in: ["pending", "processing"] }, nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
  });

  let done = 0;
  for (const row of rows) {
    // A worker that died mid-job leaves a processing row; reclaim after 5 min.
    if (row.status === "processing" && now.getTime() - row.updatedAt.getTime() < STUCK_MS) continue;

    const claimed = await db.omsOutbox.updateMany({
      where: { id: row.id, status: row.status },
      data: { status: "processing" },
    });
    if (!claimed.count) continue;

    const kind = row.kind as OmsJobKind;
    try {
      await runJob(kind, row.payload);
      await db.omsOutbox.update({
        where: { id: row.id },
        data: { status: "done", attempts: 0, lastError: null },
      });
      done++;
    } catch (e) {
      const attempts = row.attempts + 1;
      const retryable =
        e instanceof OmsNetworkError ||
        (e instanceof OmsApiError && (e.status === 429 || e.status >= 500));

      if (retryable && attempts < MAX_ATTEMPTS) {
        await db.omsOutbox.update({
          where: { id: row.id },
          data: {
            status: "pending",
            attempts,
            nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
            lastError: (e as Error).message.slice(0, 1000),
          },
        });
      } else {
        await db.omsOutbox.update({
          where: { id: row.id },
          data: {
            status: "failed",
            attempts,
            lastError: (e as Error).message.slice(0, 1000),
          },
        });
        await writeFailureNote(kind, row.payload, e);
      }
    }
  }
  return done;
}

async function runJob(kind: OmsJobKind, rawPayload: string) {
  switch (kind) {
    case "create_lead": {
      const { conversationId } = parsePayload<LeadJob>(rawPayload);
      await ensureLeadId(conversationId);
      return;
    }

    case "patch_lead": {
      const { conversationId, patch } = parsePayload<LeadJob>(rawPayload);
      if (!patch) throw new Error("Payload patch_lead kosong.");
      // Section 5: closing is set by OMS when an order is created; never PATCH it.
      if (patch.status === "closing") throw new Error("Status closing tidak boleh dikirim lewat PATCH.");

      const leadId = await ensureLeadId(conversationId);
      try {
        const lead = await updateLead(leadId, patch);
        await storeLeadSnapshot(conversationId, lead);
      } catch (e) {
        if (e instanceof OmsApiError && e.status === 409) {
          // The status already moved on; sync and stop retrying this job.
          const lead = await getLead(leadId);
          await storeLeadSnapshot(conversationId, lead);
          return;
        }
        throw e;
      }
      return;
    }

    case "create_order": {
      const { checkoutId } = parsePayload<CheckoutJob>(rawPayload);
      try {
        await submitCheckout(checkoutId);
        await autoVerifyCheckout(checkoutId);
      } catch (e) {
        if (e instanceof OmsApiError && !(e.status === 429 || e.status >= 500)) {
          const row = await db.omsCheckout.update({
            where: { id: checkoutId },
            data: { status: "failed", lastError: friendlyOmsError(e) },
          });
          await addSystemNote(
            row.conversationId,
            `Order OMS ditolak: ${friendlyOmsError(e)} Order belum dibuat.`,
          );
          return; // handled definitively; do not retry
        }
        throw e;
      }
      return;
    }

    case "verify_order": {
      const { orderId, input } = parsePayload<VerifyJob>(rawPayload);
      try {
        await submitVerification(orderId, input);
      } catch (e) {
        if (e instanceof OmsApiError && !(e.status === 429 || e.status >= 500)) {
          const row = await db.omsOrder.findUnique({ where: { id: orderId } });
          if (row) {
            await addSystemNote(
              row.conversationId,
              `Verifikasi order ${row.nomor} gagal: ${friendlyOmsError(e)}`,
            );
            if (e.kode === "perlu_verifikasi_manusia" && row.conversationId) {
              await db.conversation
                .update({ where: { id: row.conversationId }, data: { mode: "eskalasi" } })
                .catch(() => {});
              const claimed = await db.conversation.updateMany({
                where: { id: row.conversationId, omsHandoverAt: null },
                data: { omsHandoverAt: new Date() },
              });
              if (claimed.count) {
                await enqueueOmsJob(
                  "patch_lead",
                  {
                    conversationId: row.conversationId,
                    patch: {
                      handover: {
                        alasan: "Verifikasi OMS meminta CS manusia (riwayat RTS)",
                        terjadi_at: new Date().toISOString(),
                      },
                    },
                  },
                  { dedupeKey: `handover:${row.conversationId}` },
                );
              }
            }
          }
          return; // handled definitively; staff can retry manually
        }
        throw e;
      }
      return;
    }

    default:
      throw new Error(`Jenis job OMS tidak dikenal: ${kind}`);
  }
}

async function writeFailureNote(kind: OmsJobKind, rawPayload: string, e: unknown) {
  const message = friendlyOmsError(e);
  try {
    if (kind === "create_lead" || kind === "patch_lead") {
      const { conversationId } = parsePayload<LeadJob>(rawPayload);
      await addSystemNote(conversationId, `Sinkronisasi lead OMS gagal: ${message}`);
      return;
    }
    if (kind === "create_order") {
      const { checkoutId } = parsePayload<CheckoutJob>(rawPayload);
      const row = await db.omsCheckout.update({
        where: { id: checkoutId },
        data: { status: "failed", lastError: message },
      });
      // Timeouts/5xx: the order may or may not exist in OMS. Retrying is safe
      // (same external_id), creating a new order from scratch is not.
      await addSystemNote(
        row.conversationId,
        `Pembuatan order OMS gagal setelah beberapa percobaan: ${message} Status di OMS belum pasti; tekan "Coba ulang" (aman, tidak dobel) sebelum membuat order baru.`,
      );
      return;
    }
    if (kind === "verify_order") {
      const { orderId } = parsePayload<VerifyJob>(rawPayload);
      const row = await db.omsOrder.findUnique({ where: { id: orderId } });
      if (row) await addSystemNote(row.conversationId, `Verifikasi order ${row.nomor} gagal: ${message}`);
    }
  } catch (err) {
    console.error("[oms] failed to write failure note:", (err as Error).message);
  }
}
