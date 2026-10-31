// Checkout, verification, status sync, and webhook event application.
// OMS remains the source of truth for totals, COD, status, and shipping.
import { db } from "../db";
import { formatIDR } from "../format";
import { addSystemNote, deliver, deliverAutomated } from "../outbound";
import { createOrder, getOrder, verifyOrder } from "./client";
import { friendlyOmsError } from "./errors";
import { ensureLeadId } from "./lead-store";
import { orderFollowupText, orderSummaryText } from "./messages";
import { enqueueOmsJob } from "./queue";
import { rtsRiskReasons } from "./rts-risk";

/** Delay between "dikirim" and the COD cash reminder (about H-1 before arrival). */
export const COD_REMINDER_DELAY_MS = 48 * 3600_000;
import type { Checkout, EventStatusOrder, Order, OrderBaru, Pengiriman, Verifikasi } from "./types";

export function orderRowData(order: Order, checkoutId: number, conversationId: number) {
  return {
    omsOrderId: order.id,
    nomor: order.nomor,
    orderGroupId: order.order_group_id,
    checkoutId,
    conversationId,
    entitas: order.entitas,
    status: order.status,
    metodeBayar: order.metode_bayar,
    subtotal: order.subtotal,
    diskon: order.diskon,
    ongkir: order.ongkir,
    subsidiOngkir: order.subsidi_ongkir ?? 0,
    biayaCod: order.biaya_cod ?? 0,
    subsidiAdminCod: order.subsidi_admin_cod ?? 0,
    total: order.total,
    nilaiCod: order.nilai_cod,
    segmen: order.segmen ?? null,
    perluVerifikasiManusia: Boolean(order.perlu_verifikasi_manusia),
    itemsJson: JSON.stringify(order.items ?? []),
    pengirimanJson: order.pengiriman ? JSON.stringify(order.pengiriman) : null,
  };
}

function mergePengiriman(currentJson: string | null, event: EventStatusOrder): Pengiriman | null {
  let current: Partial<Pengiriman> = {};
  if (currentJson) {
    try {
      current = JSON.parse(currentJson) as Partial<Pengiriman>;
    } catch {
      current = {};
    }
  }
  if (!currentJson && !event.data.kurir && !event.data.resi) return null;

  return {
    kurir: event.data.kurir ?? current.kurir ?? "",
    resi: event.data.resi ?? current.resi ?? "",
    ...(current.status_kurir !== undefined ? { status_kurir: current.status_kurir } : {}),
    ...(event.data.percobaan_antar !== null && event.data.percobaan_antar !== undefined
      ? { percobaan_antar: event.data.percobaan_antar }
      : current.percobaan_antar !== undefined
        ? { percobaan_antar: current.percobaan_antar }
        : {}),
    ...(current.dikirim_at !== undefined
      ? { dikirim_at: current.dikirim_at }
      : event.data.status === "dikirim"
        ? { dikirim_at: event.terjadi_at }
        : {}),
    ...(current.diterima_at !== undefined
      ? { diterima_at: current.diterima_at }
      : event.data.status === "terkirim"
        ? { diterima_at: event.terjadi_at }
        : {}),
  };
}

/** Persists a Checkout response, notifies the buyer once, and applies the RTS flag. */
export async function applyCheckout(checkoutId: number, checkout: Checkout) {
  const existing = await db.omsCheckout.findUniqueOrThrow({ where: { id: checkoutId } });

  // Store the order mirrors first; only then mark the checkout created, so a
  // crash in between is retried instead of looking complete.
  for (const order of checkout.orders) {
    const data = orderRowData(order, existing.id, existing.conversationId);
    await db.omsOrder.upsert({ where: { omsOrderId: order.id }, update: data, create: data });
  }

  const row = await db.omsCheckout.update({
    where: { id: checkoutId },
    data: { orderGroupId: checkout.order_group_id, status: "created", lastError: null },
  });

  const claimed = await db.omsCheckout.updateMany({
    where: { id: row.id, notifiedAt: null },
    data: { notifiedAt: new Date() },
  });
  if (claimed.count) {
    const result = await deliver(
      row.conversationId,
      orderSummaryText(checkout.orders, existing.createdByAi),
      existing.createdByAi ? "ai" : "staff",
    );
    if (result.status === "failed") {
      await addSystemNote(
        row.conversationId,
        `Pesanan OMS dibuat, tetapi ringkasan gagal dikirim ke pembeli: ${result.error ?? "tidak diketahui"}.`,
      );
    }
  }

  await addSystemNote(
    row.conversationId,
    `Order OMS dibuat: ${checkout.orders
      .map((order) => `${order.nomor} (${order.entitas}) ${formatIDR(order.total)}`)
      .join(", ")}.`,
  );

  if (checkout.orders.some((order) => order.perlu_verifikasi_manusia)) {
    const conv = await db.conversation.findUnique({
      where: { id: row.conversationId },
      select: { mode: true, omsHandoverAt: true },
    });
    if (conv) {
      if (conv.mode !== "eskalasi") {
        await db.conversation.update({ where: { id: row.conversationId }, data: { mode: "eskalasi" } });
      }
      if (!conv.omsHandoverAt) {
        await db.conversation.update({ where: { id: row.conversationId }, data: { omsHandoverAt: new Date() } });
        await enqueueOmsJob(
          "patch_lead",
          {
            conversationId: row.conversationId,
            patch: {
              handover: {
                alasan: "Order perlu verifikasi manusia (riwayat RTS)",
                terjadi_at: new Date().toISOString(),
              },
            },
          },
          { dedupeKey: `handover:${row.conversationId}` },
        );
      }
      await addSystemNote(row.conversationId, "Order perlu verifikasi manusia (riwayat RTS); percakapan dieskalasi ke staf.");
    }
  }

  return checkout;
}

/**
 * Sends a prepared checkout to OMS. The local row already holds a stable
 * external_id, so retries never create a second order.
 */
export async function submitCheckout(checkoutId: number) {
  const row = await db.omsCheckout.findUniqueOrThrow({ where: { id: checkoutId } });
  if (row.status === "created") return null;

  const payload = JSON.parse(row.payload) as OrderBaru;
  const leadId = await ensureLeadId(row.conversationId);
  const checkout = await createOrder({ ...payload, lead_id: leadId });
  await applyCheckout(row.id, checkout);
  return checkout;
}

/**
 * Verifies the orders of an AI-created checkout when the assigned agent has
 * autoVerifyOrders enabled. Orders flagged for human review are never verified.
 */
export async function autoVerifyCheckout(checkoutId: number) {
  const row = await db.omsCheckout.findUnique({
    where: { id: checkoutId },
    include: { orders: true, conversation: { select: { deviceId: true } } },
  });
  if (!row?.createdByAi) return { verified: 0, skipped: 0 };
  const deviceId = row.conversation.deviceId;
  const agent = deviceId
    ? await db.aiAgent.findFirst({
        where: { active: true, autoVerifyOrders: true, devices: { some: { id: deviceId } } },
        select: { id: true },
      })
    : null;
  if (!agent) return { verified: 0, skipped: row.orders.length };

  // Risky orders (incomplete address, earlier RTS, large COD) go to staff.
  const payload = JSON.parse(row.payload) as OrderBaru;
  const previousRts = await db.omsOrder.count({
    where: { conversationId: row.conversationId, status: "rts", checkoutId: { not: row.id } },
  });
  const totalCod = row.orders.reduce((sum, o) => sum + (o.metodeBayar === "cod" ? o.nilaiCod : 0), 0);
  const reasons = rtsRiskReasons({ alamat: payload.alamat, totalCod, previousRts });
  if (reasons.length) {
    await db.conversation.update({
      where: { id: row.conversationId },
      data: { mode: "eskalasi", modeChangedAt: new Date() },
    });
    await addSystemNote(
      row.conversationId,
      `Order ${row.orders.map((o) => o.nomor).join(", ")} tidak diverifikasi otomatis: ${reasons.join("; ")}. Mohon konfirmasi manual ke pelanggan lalu klik Verifikasi.`,
    );
    return { verified: 0, skipped: row.orders.length };
  }

  let verified = 0;
  let skipped = 0;
  for (const order of row.orders) {
    if (order.status !== "baru" || order.perluVerifikasiManusia) {
      skipped++;
      continue;
    }
    try {
      await submitVerification(order.id, {
        dikonfirmasi_at: new Date().toISOString(),
        nilai_cod_dikonfirmasi: order.nilaiCod,
        catatan: "Dikonfirmasi otomatis oleh AI Agent setelah pelanggan menyetujui rincian.",
      });
      verified++;
    } catch (e) {
      skipped++;
      await addSystemNote(
        order.conversationId,
        `Verifikasi otomatis order ${order.nomor} gagal: ${friendlyOmsError(e)}`,
      );
    }
  }
  return { verified, skipped };
}

export async function submitVerification(orderRowId: number, input: Verifikasi) {
  const row = await db.omsOrder.findUniqueOrThrow({ where: { id: orderRowId } });
  const order = await verifyOrder(row.omsOrderId, input);
  await db.omsOrder.update({
    where: { id: row.id },
    data: {
      status: order.status,
      subtotal: order.subtotal,
      diskon: order.diskon,
      ongkir: order.ongkir,
      subsidiOngkir: order.subsidi_ongkir ?? 0,
      biayaCod: order.biaya_cod ?? 0,
      subsidiAdminCod: order.subsidi_admin_cod ?? 0,
      total: order.total,
      nilaiCod: order.nilai_cod,
      segmen: order.segmen ?? null,
      itemsJson: JSON.stringify(order.items ?? []),
      pengirimanJson: order.pengiriman ? JSON.stringify(order.pengiriman) : row.pengirimanJson,
    },
  });
  return order;
}

/**
 * Polls OMS for one order. Status changes found this way go through the same
 * path as webhook events (system note, customer follow-up, escalation), so a
 * change is never applied silently.
 */
export async function syncOrder(orderRowId: number) {
  const row = await db.omsOrder.findUniqueOrThrow({ where: { id: orderRowId } });
  const order = await getOrder(row.omsOrderId);
  await applyStatusEvent(row.id, pollEvent(order), { source: "poll" });
  await db.omsOrder.update({
    where: { id: row.id },
    data: {
      // GET is the current OMS state, so it also corrects a status that a
      // webhook may not have delivered (applyStatusEvent ignores regressions).
      status: order.status,
      subtotal: order.subtotal,
      diskon: order.diskon,
      ongkir: order.ongkir,
      subsidiOngkir: order.subsidi_ongkir ?? 0,
      biayaCod: order.biaya_cod ?? 0,
      subsidiAdminCod: order.subsidi_admin_cod ?? 0,
      total: order.total,
      nilaiCod: order.nilai_cod,
      segmen: order.segmen ?? null,
      itemsJson: JSON.stringify(order.items ?? []),
      ...(order.pengiriman ? { pengirimanJson: JSON.stringify(order.pengiriman) } : {}),
      lastPolledAt: new Date(),
    },
  });
  return order;
}

/** A polled order expressed as a status event (no reason: polling cannot know it). */
function pollEvent(order: Order): EventStatusOrder {
  return {
    event_id: `poll:${order.id}`,
    jenis: "order.status_changed",
    terjadi_at: new Date().toISOString(),
    data: {
      order_id: order.id,
      nomor: order.nomor,
      order_group_id: order.order_group_id,
      status_sebelum: null,
      status: order.status,
      alasan: null,
      kurir: order.pengiriman?.kurir ?? null,
      resi: order.pengiriman?.resi ?? null,
      percobaan_antar: order.pengiriman?.percobaan_antar ?? null,
    },
  };
}

/** Forward-only order of OMS statuses; the terminal states share the top rank. */
const STATUS_RANK: Record<string, number> = {
  baru: 0,
  terverifikasi: 1,
  di_gudang: 2,
  dikirim: 3,
  terkirim: 4,
  batal: 4,
  rts: 4,
};

/** True when `next` would move the order backwards (a late, out-of-order event). */
export function isStatusRegression(current: string, next: string) {
  const from = STATUS_RANK[current];
  const to = STATUS_RANK[next];
  return from !== undefined && to !== undefined && to < from;
}

const PROBLEM_REASONS = new Set(["gagal_antar", "cod_ditolak"]);

function needsStaff(event: EventStatusOrder) {
  return (
    event.data.status === "rts" ||
    event.data.status === "batal" ||
    PROBLEM_REASONS.has(event.data.alasan ?? "")
  );
}

function storedResi(pengirimanJson: string | null) {
  if (!pengirimanJson) return null;
  try {
    return (JSON.parse(pengirimanJson) as Partial<Pengiriman>).resi || null;
  } catch {
    return null;
  }
}

/**
 * Applies one order.status_changed event (webhook or poll).
 * - Older or regressing events never change the stored status.
 * - The status write is conditional (compare-and-set on status + watermark),
 *   so concurrent deliveries of the same change notify the customer once.
 * - A late problem event (gagal_antar, cod_ditolak) still alerts staff and the
 *   customer even when a poll already moved the watermark past it.
 */
export async function applyStatusEvent(
  orderRowId: number,
  event: EventStatusOrder,
  opts: { source?: "webhook" | "poll" } = {},
) {
  const row = await db.omsOrder.findUniqueOrThrow({ where: { id: orderRowId } });
  const occurred = new Date(event.terjadi_at);
  if (Number.isNaN(occurred.getTime())) throw new Error("terjadi_at tidak valid.");

  const problem = PROBLEM_REASONS.has(event.data.alasan ?? "");
  const stale = Boolean(row.lastEventAt && occurred <= row.lastEventAt);
  const regression = isStatusRegression(row.status, event.data.status);
  if ((stale || regression) && !(problem && opts.source !== "poll")) return { ignored: true as const };

  const statusChanged = !stale && !regression && row.status !== event.data.status;
  const resiNew = Boolean(event.data.resi) && event.data.resi !== storedResi(row.pengirimanJson);

  if (!stale && !regression) {
    const pengiriman = mergePengiriman(row.pengirimanJson, event);
    const claimed = await db.omsOrder.updateMany({
      where: {
        id: row.id,
        status: row.status,
        OR: [{ lastEventAt: null }, { lastEventAt: { lt: occurred } }],
      },
      data: {
        status: event.data.status,
        pengirimanJson: pengiriman ? JSON.stringify(pengiriman) : row.pengirimanJson,
        lastEventAt: occurred,
      },
    });
    if (!claimed.count) return { ignored: true as const }; // another worker applied it
  }

  if (!statusChanged && !resiNew && !problem) return { updated: true as const, notified: false };

  await addSystemNote(
    row.conversationId,
    `Status order ${row.nomor}: ${event.data.status}${event.data.alasan ? ` (${event.data.alasan})` : ""}${
      opts.source === "poll" ? " (dari sinkronisasi OMS)" : ""
    }.`,
  );

  const text = orderFollowupText(event, row);
  if (text) await deliverAutomated(row.conversationId, text);

  // COD still on the way two days after shipping: remind the buyer to prepare
  // the cash (the job re-checks the status before sending).
  if (statusChanged && event.data.status === "dikirim" && row.metodeBayar === "cod") {
    await enqueueOmsJob(
      "cod_reminder",
      { orderId: row.id },
      { dedupeKey: `cod-reminder:${row.id}`, delayMs: COD_REMINDER_DELAY_MS },
    );
  }

  if (needsStaff(event)) {
    const conv = await db.conversation.findUnique({
      where: { id: row.conversationId },
      select: { mode: true, omsHandoverAt: true },
    });
    if (conv) {
      if (conv.mode !== "eskalasi") {
        await db.conversation.update({ where: { id: row.conversationId }, data: { mode: "eskalasi" } });
      }
      if (!conv.omsHandoverAt) {
        await db.conversation.update({ where: { id: row.conversationId }, data: { omsHandoverAt: new Date() } });
        await enqueueOmsJob(
          "patch_lead",
          {
            conversationId: row.conversationId,
            patch: {
              handover: {
                alasan: `Order ${row.nomor}: ${event.data.alasan ?? event.data.status}`,
                terjadi_at: event.terjadi_at,
              },
            },
          },
          { dedupeKey: `handover:${row.conversationId}` },
        );
      }
      await addSystemNote(row.conversationId, "Order bermasalah; percakapan dieskalasi untuk tindak lanjut staf.");
    }
  }

  return { updated: true as const, notified: true };
}

/** Polling fallback while the OMS webhook is not active (max every 30 min per order). */
export async function pollOpenOrders(limit = 50) {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000);
  const rows = await db.omsOrder.findMany({
    where: {
      status: { notIn: ["terkirim", "batal", "rts"] },
      OR: [{ lastPolledAt: null }, { lastPolledAt: { lt: cutoff } }],
    },
    orderBy: { id: "asc" },
    take: limit,
  });

  let checked = 0;
  for (const row of rows) {
    try {
      await syncOrder(row.id);
      checked++;
    } catch (e) {
      console.error(`[oms] poll order ${row.nomor} failed:`, (e as Error).message);
      await db.omsOrder.update({ where: { id: row.id }, data: { lastPolledAt: new Date() } }).catch(() => {});
    }
  }
  return checked;
}
