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

export async function syncOrder(orderRowId: number) {
  const row = await db.omsOrder.findUniqueOrThrow({ where: { id: orderRowId } });
  const order = await getOrder(row.omsOrderId);
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
      pengirimanJson: order.pengiriman ? JSON.stringify(order.pengiriman) : null,
      lastPolledAt: new Date(),
      // A fresh GET reflects OMS state at this moment; use it as a watermark so
      // a delayed, older webhook event cannot regress the status.
      lastEventAt: new Date(),
    },
  });
  return order;
}

function needsStaff(event: EventStatusOrder) {
  return (
    event.data.status === "rts" ||
    event.data.status === "batal" ||
    event.data.alasan === "gagal_antar" ||
    event.data.alasan === "cod_ditolak"
  );
}

/** Applies one order.status_changed event (webhook). Older events are ignored. */
export async function applyStatusEvent(orderRowId: number, event: EventStatusOrder) {
  const row = await db.omsOrder.findUniqueOrThrow({ where: { id: orderRowId } });
  const occurred = new Date(event.terjadi_at);
  if (Number.isNaN(occurred.getTime())) throw new Error("terjadi_at tidak valid.");

  // Ordering is not guaranteed; an event older than the stored status is stale.
  if (row.lastEventAt && occurred < row.lastEventAt) return { ignored: true as const };

  const pengiriman = mergePengiriman(row.pengirimanJson, event);
  await db.omsOrder.update({
    where: { id: row.id },
    data: {
      status: event.data.status,
      pengirimanJson: pengiriman ? JSON.stringify(pengiriman) : row.pengirimanJson,
      lastEventAt: occurred,
    },
  });

  await addSystemNote(
    row.conversationId,
    `Status order ${row.nomor}: ${event.data.status}${event.data.alasan ? ` (${event.data.alasan})` : ""}.`,
  );

  const text = orderFollowupText(event);
  if (text) await deliverAutomated(row.conversationId, text);

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

  return { updated: true as const };
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
