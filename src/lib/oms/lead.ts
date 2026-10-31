// Lead lifecycle hooks called from messaging. All functions are best-effort:
// a broken OMS must never stop a customer message from being stored/replied.
import { db } from "../db";
import { omsConfigured } from "./client";
import { storeAttribution, type AttributionInput } from "./lead-store";
import { enqueueOmsJob } from "./queue";

export async function omsOnInbound(conversationId: number, attribution?: AttributionInput) {
  if (!omsConfigured()) return;
  try {
    if (attribution) await storeAttribution(conversationId, attribution);
    const conv = await db.conversation.findUnique({
      where: { id: conversationId },
      select: { omsLeadId: true },
    });
    if (conv?.omsLeadId) return;
    // The worker creates the lead with external_id conv_<id>, so this is safe
    // to enqueue more than once.
    await enqueueOmsJob("create_lead", { conversationId }, { dedupeKey: `lead:${conversationId}` });
  } catch (e) {
    console.error("[oms] inbound hook failed:", (e as Error).message);
  }
}

export async function omsOnFirstResponse(conversationId: number) {
  if (!omsConfigured()) return;
  try {
    // Claim exactly once; respon_pertama_at is only recorded once by OMS.
    const claimed = await db.conversation.updateMany({
      where: { id: conversationId, omsFirstResponseAt: null },
      data: { omsFirstResponseAt: new Date() },
    });
    if (!claimed.count) return;
    await enqueueOmsJob(
      "patch_lead",
      { conversationId, patch: { status: "direspon", respon_pertama_at: new Date().toISOString() } },
      { dedupeKey: `first-response:${conversationId}` },
    );
  } catch (e) {
    console.error("[oms] first-response hook failed:", (e as Error).message);
  }
}

export async function omsOnFollowUp(conversationId: number) {
  if (!omsConfigured()) return;
  try {
    const conv = await db.conversation.findUnique({
      where: { id: conversationId },
      select: { omsLeadStatus: true },
    });
    if (!conv || conv.omsLeadStatus === "closing" || conv.omsLeadStatus === "gagal") return;
    await db.conversation.update({ where: { id: conversationId }, data: { omsLeadStatus: "follow_up" } });
    await enqueueOmsJob(
      "patch_lead",
      { conversationId, patch: { status: "follow_up" } },
      { dedupeKey: `follow-up:${conversationId}` },
    );
  } catch (e) {
    console.error("[oms] follow-up hook failed:", (e as Error).message);
  }
}

export async function omsOnHandover(conversationId: number, alasan: string) {
  if (!omsConfigured()) return;
  try {
    const claimed = await db.conversation.updateMany({
      where: { id: conversationId, omsHandoverAt: null },
      data: { omsHandoverAt: new Date() },
    });
    if (!claimed.count) return;
    await enqueueOmsJob(
      "patch_lead",
      {
        conversationId,
        patch: { handover: { alasan: alasan.slice(0, 500), terjadi_at: new Date().toISOString() } },
      },
      { dedupeKey: `handover:${conversationId}` },
    );
  } catch (e) {
    console.error("[oms] handover hook failed:", (e as Error).message);
  }
}

/** Staff action: conversation closed without an order. Never sends `closing`. */
export async function omsMarkFailed(conversationId: number) {
  if (!omsConfigured()) throw new Error("OMS belum dikonfigurasi.");
  const conv = await db.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    select: { omsLeadStatus: true },
  });
  if (conv.omsLeadStatus === "closing") throw new Error("Lead sudah closing; status tidak bisa diubah lagi.");
  if (conv.omsLeadStatus === "gagal") return;

  await db.conversation.update({ where: { id: conversationId }, data: { omsLeadStatus: "gagal" } });
  await enqueueOmsJob(
    "patch_lead",
    { conversationId, patch: { status: "gagal" } },
    { dedupeKey: `failed:${conversationId}` },
  );
}
