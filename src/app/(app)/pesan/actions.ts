"use server";

import { Prisma } from "@prisma/client";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { optId, required, run, str, type ActionState } from "@/lib/action";
import { aiRespond, recordInbound, sendStaffMessage, sendTemplateMessage } from "@/lib/messaging";
import { addSystemNote } from "@/lib/outbound";
import { formatIDR } from "@/lib/format";
import { quoteOngkir } from "@/lib/ongkir-quote";
import { isAdminRole } from "@/lib/permissions";
import { emitWebhook } from "@/lib/webhook";
import { customerSegment, orderQuote, regionFromText, type Segment } from "@/lib/promo";
import { getOmsCatalog } from "@/lib/oms/catalog";
import { OmsApiError, omsConfigured } from "@/lib/oms/client";
import { friendlyOmsError } from "@/lib/oms/errors";
import { omsMarkFailed, omsOnHandover } from "@/lib/oms/lead";
import { orderFingerprint, staffCheckoutExternalId, storedFingerprint } from "@/lib/oms/dedupe";
import { assertRupiah, isRetryableStatus, isoUtc, normalizePhone } from "@/lib/oms/normalize";
import { submitCheckout, submitVerification, syncOrder } from "@/lib/oms/orders";
import { processOutbox } from "@/lib/oms/outbox";
import { enqueueCheckoutSend, enqueueOmsJob } from "@/lib/oms/queue";
import type { ItemBaru, MetodeBayar, OrderBaru, Verifikasi } from "@/lib/oms/types";

export async function sendMessage(_: ActionState, fd: FormData) {
  return run(async () => {
    await requirePermission("pesan");
    const id = Number(fd.get("conversationId"));
    const templateId = optId(fd, "templateId");
    const conv = await db.conversation.findUniqueOrThrow({ where: { id } });
    if (conv.mode === "ai") throw new Error("Agen AI sedang aktif. Matikan Agen AI untuk membalas manual.");
    if (templateId) await sendTemplateMessage(id, templateId);
    else await sendStaffMessage(id, required(fd, "text", "Pesan"));
    revalidatePath("/pesan");
    return "Pesan terkirim.";
  });
}

export async function updateConversation(_: ActionState, fd: FormData) {
  return run(async () => {
    await requirePermission("pesan");
    const id = Number(fd.get("conversationId"));
    const mode = str(fd, "mode");
    if (!["ai", "staf", "eskalasi"].includes(mode)) throw new Error("Mode tidak valid.");
    const before = await db.conversation.findUniqueOrThrow({ where: { id } });
    const conv = await db.conversation.update({
      where: { id },
      data: { mode, assignedToId: optId(fd, "assignedToId"), ...(before.mode !== mode ? { modeChangedAt: new Date() } : {}) },
    });
    await db.customer.update({ where: { id: conv.customerId }, data: { stageId: optId(fd, "stageId") } });
    await emitWebhook("conversation.status_changed", {
      conversation_id: id,
      mode: conv.mode,
      assigned_to_id: conv.assignedToId,
    });

    if (mode !== "ai") {
      await omsOnHandover(id, mode === "eskalasi" ? "Percakapan dieskalasi ke staf" : "Percakapan ditangani staf");
      after(() => processOutbox().catch((e) => console.error("[oms] outbox kick failed:", (e as Error).message)));
    } else if (conv.omsHandoverAt) {
      await addSystemNote(id, "Percakapan kembali ke AI, tetapi handover di OMS tetap berlaku dan tidak bisa dibatalkan.");
    }

    revalidatePath("/pesan");
    return "Percakapan diperbarui.";
  });
}

export async function requestAiReply(_: ActionState, fd: FormData) {
  return run(async () => {
    await requirePermission("pesan");
    const status = await aiRespond(Number(fd.get("conversationId")));
    revalidatePath("/pesan");
    const messages: Record<string, string> = {
      replied: "AI sudah membalas.",
      escalated: "Percakapan dieskalasi ke staf.",
      no_agent: "Belum ada AI Agent yang ditugaskan ke perangkat ini.",
      error: "AI gagal membalas. Lihat catatan di percakapan.",
    };
    if (status === "no_agent") throw new Error(messages.no_agent);
    return messages[status] ?? "Selesai.";
  });
}

/** Testing helper: injects an inbound message as if it came from WhatsApp. */
export async function simulateInbound(_: ActionState, fd: FormData) {
  return run(async () => {
    await requirePermission("pesan");
    await recordInbound({
      phone: required(fd, "phone", "Nomor"),
      name: str(fd, "name"),
      text: required(fd, "text", "Pesan"),
      deviceId: optId(fd, "deviceId"),
    });
    after(() => processOutbox().catch((e) => console.error("[oms] outbox kick failed:", (e as Error).message)));
    revalidatePath("/pesan");
    return "Pesan masuk disimulasikan.";
  });
}

/** Agen AI switch in the chat room: on = AI replies, off = staff reply. */
export async function setAiMode(conversationId: number, on: boolean): Promise<{ error?: string }> {
  try {
    const me = await requirePermission("pesan");
    const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    const mode = on ? "ai" : "staf";
    if (conv.mode !== mode) {
      await db.conversation.update({ where: { id: conversationId }, data: { mode, modeChangedAt: new Date() } });
      await db.message.create({
        data: { conversationId, direction: "out", sender: "system", status: "sent", text: on ? `Agen AI dinyalakan oleh ${me.name}.` : `Agen AI dimatikan oleh ${me.name}. Staf membalas manual.` },
      });
      await emitWebhook("conversation.status_changed", {
        conversation_id: conversationId,
        mode,
        assigned_to_id: conv.assignedToId,
      });
      if (!on) {
        await omsOnHandover(conversationId, "Agen AI dimatikan; staf membalas manual");
        after(() => processOutbox().catch((e) => console.error("[oms] outbox kick failed:", (e as Error).message)));
      } else if (conv.omsHandoverAt) {
        await addSystemNote(conversationId, "Agen AI dinyalakan kembali, tetapi handover di OMS tetap berlaku dan tidak bisa dibatalkan.");
      }
    }
    revalidatePath("/pesan");
    return {};
  } catch (e) {
    return { error: (e as Error).message || "Gagal mengubah Agen AI." };
  }
}
/**
 * Pricing rules for non-admin staff: no discount, and ongkir may not be below
 * the server's J&T quote for the address. Returns a note to log when the quote
 * is unavailable (RajaOngkir down) and the staff value is accepted unchecked.
 */
async function assertStaffPricing(input: {
  diskon: number;
  ongkir: number;
  kecamatan: string;
  kota: string;
  provinsi: string;
  kode_pos: string;
}): Promise<string | null> {
  if (input.diskon > 0) throw new Error("Hanya Admin yang boleh memberi diskon.");
  const quote = await quoteOngkir({
    kecamatan: input.kecamatan || undefined,
    kota: input.kota,
    provinsi: input.provinsi,
    kode_pos: input.kode_pos || undefined,
  }).catch(() => null);
  if (!quote) {
    return `Ongkir ${formatIDR(input.ongkir)} diisi manual dan tidak bisa dicek otomatis (cek ongkir gagal).`;
  }
  if (input.ongkir < quote.cost) {
    throw new Error(
      `Ongkir minimal ${formatIDR(quote.cost)} (${quote.courier} ${quote.service} ke ${quote.destination}). Hubungi Admin untuk ongkir lebih rendah.`,
    );
  }
  return null;
}

function sameFormMessage(status: string) {
  if (status === "created") return "Pesanan dari form ini sudah dibuat. Lihat daftar order.";
  if (status === "failed") return "Pesanan dari form ini gagal. Gunakan tombol Coba ulang di daftar order.";
  return "Pesanan dari form ini sedang diproses ke OMS.";
}

/** Staff-assisted checkout: one POST /orders for all items in the conversation. */
export async function createOmsCheckout(_: ActionState, fd: FormData) {
  return run(async () => {
    const me = await requirePermission("pesan");
    // Discount, segment and below-quote ongkir change what the courier collects,
    // so only Admin may set them (see assertStaffPricing).
    const isAdmin = isAdminRole(me.role);
    if (!omsConfigured()) throw new Error("OMS belum dikonfigurasi. Isi OMS_BASE_URL dan OMS_API_KEY.");

    const conversationId = Number(fd.get("conversationId"));
    const conv = await db.conversation.findUnique({ where: { id: conversationId }, include: { customer: true } });
    if (!conv) throw new Error("Percakapan tidak ditemukan.");

    // One external_id per opened form: a double click or a resubmit after a
    // slow/failed response reuses it, so OMS (idempotent on it) never gets a
    // second order from the same form.
    const externalId = staffCheckoutExternalId(conversationId, str(fd, "nonce"));
    const sameForm = await db.omsCheckout.findUnique({ where: { externalId } });
    if (sameForm) return sameFormMessage(sameForm.status);

    const pending = await db.omsCheckout.findFirst({
      where: { conversationId, status: "pending", createdAt: { gt: new Date(Date.now() - 10 * 60_000) } },
    });
    if (pending) throw new Error("Pesanan sebelumnya masih diproses. Tunggu sebentar atau cek daftar order.");

    let parsedItems: unknown;
    try {
      parsedItems = JSON.parse(str(fd, "items"));
    } catch {
      throw new Error("Daftar item tidak valid.");
    }
    if (!Array.isArray(parsedItems) || parsedItems.length < 1 || parsedItems.length > 20) {
      throw new Error("Pilih 1–20 item.");
    }
    const items: ItemBaru[] = parsedItems.map((row) => {
      const r = row as { sku?: unknown; qty?: unknown };
      const sku = typeof r.sku === "string" ? r.sku.trim() : "";
      const qty = Number(r.qty);
      if (!sku) throw new Error("SKU wajib diisi.");
      if (!Number.isInteger(qty) || qty < 1 || qty > 100) throw new Error("Jumlah per item harus 1–100.");
      return { sku, qty };
    });
    if (new Set(items.map((item) => item.sku)).size !== items.length) {
      throw new Error("SKU tidak boleh duplikat.");
    }

    const metode = str(fd, "metode_bayar");
    if (metode !== "cod" && metode !== "transfer") throw new Error("Metode bayar tidak valid.");
    const metode_bayar = metode as MetodeBayar;

    const nama = required(fd, "nama", "Nama penerima");
    const no_wa = normalizePhone(required(fd, "no_wa", "Nomor WA penerima"));
    const alamat = required(fd, "alamat", "Alamat");
    const kota = required(fd, "kota", "Kota");
    const provinsi = required(fd, "provinsi", "Provinsi");
    const kelurahan = str(fd, "kelurahan");
    const kecamatan = str(fd, "kecamatan");
    const kode_pos = str(fd, "kode_pos");
    const catatan = str(fd, "catatan");
    if (kode_pos && !/^\d{5}$/.test(kode_pos)) throw new Error("Kode pos harus 5 digit.");

    const ongkir = Number(fd.get("ongkir") ?? 0);
    const diskon = Number(fd.get("diskon") ?? 0);
    assertRupiah(ongkir, "Ongkir");
    assertRupiah(diskon, "Diskon");
    const ongkirNote = isAdmin
      ? null
      : await assertStaffPricing({ diskon, ongkir, kecamatan, kota, provinsi, kode_pos });

    // OMS v2: the CS AI must send the total and COD breakdown; OMS validates it
    // against its own active prices (GET /prices).
    const catalog = await getOmsCatalog();
    if (!catalog) throw new Error("Katalog OMS tidak tersedia. Coba lagi sebelum membuat order.");
    const priceBySku = new Map(catalog.prices.map((price) => [price.sku, price]));
    let subtotal = 0;
    for (const item of items) {
      const price = priceBySku.get(item.sku);
      if (!price) throw new Error(`SKU ${item.sku} tidak ditemukan di katalog OMS.`);
      subtotal += price.harga_jual * item.qty;
    }
    if (diskon > subtotal) throw new Error("Diskon tidak boleh melebihi subtotal.");

    // Non-admins always get the segment derived from the customer's history.
    const segmenInput = isAdmin ? str(fd, "segmen") : "";
    const segmen: Segment =
      segmenInput === "nc" || segmenInput === "ro" || segmenInput === "reseller"
        ? segmenInput
        : await customerSegment(conv.customerId);
    const region = regionFromText(provinsi) ?? "luar";
    const quote = orderQuote({
      subtotal,
      ongkir,
      diskon,
      metode: metode_bayar,
      segment: segmen,
      region,
    });
    if (quote.total < 0) throw new Error("Total order tidak boleh negatif.");

    const payload: OrderBaru = {
      external_id: externalId,
      lead_id: "", // filled by submitCheckout
      metode_bayar,
      penerima: { nama, no_wa },
      alamat: {
        alamat,
        ...(kelurahan ? { kelurahan } : {}),
        ...(kecamatan ? { kecamatan } : {}),
        kota,
        provinsi,
        ...(kode_pos ? { kode_pos } : {}),
      },
      items,
      ongkir,
      diskon,
      subsidi_ongkir: quote.shippingSubsidy,
      biaya_cod: quote.codFee,
      subsidi_admin_cod: quote.adminSubsidy,
      total: quote.total,
      segmen,
      ...(catatan ? { catatan } : {}),
    };

    // A new form with the same cart, recipient and address as a recent order is
    // most likely a duplicate; staff must tick "Ini order baru" to proceed.
    if (fd.get("izinkan_duplikat") !== "on") {
      const fingerprint = orderFingerprint(payload);
      const recent = await db.omsCheckout.findMany({
        where: { conversationId, status: { in: ["pending", "created"] }, createdAt: { gt: new Date(Date.now() - 24 * 3600_000) } },
        select: { payload: true },
      });
      if (recent.some((r) => storedFingerprint(r.payload) === fingerprint)) {
        throw new Error(
          "Order dengan item, penerima, dan alamat yang sama sudah dibuat dalam 24 jam terakhir. Centang \"Ini order baru\" jika pelanggan memang memesan lagi.",
        );
      }
    }

    let row;
    try {
      row = await db.omsCheckout.create({
        data: { externalId: payload.external_id, conversationId, payload: JSON.stringify(payload) },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return sameFormMessage("pending");
      throw e;
    }
    if (ongkirNote) await addSystemNote(conversationId, `${ongkirNote} Diisi oleh ${me.name}.`);

    // If the lead is not created yet, let the outbox create it first instead
    // of blocking the UI on a slow/unreachable OMS.
    if (!conv.omsLeadId) {
      await enqueueCheckoutSend(row.id);
      await addSystemNote(
        conversationId,
        "Pesanan sedang diproses ke OMS; lead dan nomor order akan dibuat otomatis.",
      );
      after(() => processOutbox().catch((e) => console.error("[oms] outbox kick failed:", (e as Error).message)));
      revalidatePath("/pesan");
      return "Lead OMS belum siap. Pesanan disimpan di antrian dan akan diproses otomatis.";
    }

    try {
      const checkout = await submitCheckout(row.id);
      after(() => processOutbox().catch((e) => console.error("[oms] outbox kick failed:", (e as Error).message)));
      revalidatePath("/pesan");
      if (!checkout) return "Pesanan sudah tercatat.";
      return `Pesanan dibuat: ${checkout.orders
        .map((order) => `${order.nomor} (${formatIDR(order.total)})`)
        .join(", ")}.`;
    } catch (e) {
      if (e instanceof OmsApiError && !isRetryableStatus(e.status)) {
        const message = friendlyOmsError(e);
        await db.omsCheckout.update({
          where: { id: row.id },
          data: { status: "failed", lastError: message },
        });
        await addSystemNote(conversationId, `Order OMS ditolak: ${message} Order belum dibuat.`);
        throw new Error(message);
      }
      // Network/timeout/5xx: keep the order queued, never claim it was created.
      await enqueueCheckoutSend(row.id);
      await addSystemNote(
        conversationId,
        "Pesanan sedang diproses ke OMS; nomor order akan muncul setelah OMS merespons.",
      );
      after(() => processOutbox().catch((err) => console.error("[oms] outbox kick failed:", (err as Error).message)));
      revalidatePath("/pesan");
      return "OMS belum merespons. Pesanan disimpan di antrian dan akan dicoba ulang otomatis.";
    }
  });
}

/** Verifies one order after the buyer confirms address, COD amount, and willingness to pay. */
export async function verifyOmsOrder(_: ActionState, fd: FormData) {
  return run(async () => {
    await requirePermission("pesan");
    if (!omsConfigured()) throw new Error("OMS belum dikonfigurasi. Isi OMS_BASE_URL dan OMS_API_KEY.");

    const orderId = Number(fd.get("orderId"));
    const order = await db.omsOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new Error("Order tidak ditemukan.");
    if (order.status !== "baru") throw new Error(`Order sudah berstatus ${order.status}; tidak perlu verifikasi.`);
    if (order.perluVerifikasiManusia) {
      throw new Error("Order ini perlu verifikasi CS manusia (riwayat RTS).");
    }
    if (fd.get("konfirmasi") !== "on") {
      throw new Error("Centang konfirmasi bahwa pembeli sudah setuju dengan alamat dan nilai COD.");
    }

    const input: Verifikasi = {
      dikonfirmasi_at: isoUtc(),
      // Must match the OMS order exactly; 0 for transfer.
      nilai_cod_dikonfirmasi: order.nilaiCod,
      ...(str(fd, "catatan") ? { catatan: str(fd, "catatan") } : {}),
    };

    try {
      const updated = await submitVerification(order.id, input);
      revalidatePath("/pesan");
      return `Order ${order.nomor} terverifikasi (status ${updated.status}).`;
    } catch (e) {
      if (e instanceof OmsApiError && e.kode === "perlu_verifikasi_manusia") {
        await db.conversation.update({ where: { id: order.conversationId }, data: { mode: "eskalasi" } });
        await omsOnHandover(order.conversationId, "Verifikasi OMS meminta CS manusia (riwayat RTS)");
        after(() => processOutbox().catch((err) => console.error("[oms] outbox kick failed:", (err as Error).message)));
        throw new Error(friendlyOmsError(e));
      }
      if (e instanceof OmsApiError && !isRetryableStatus(e.status)) throw new Error(friendlyOmsError(e));

      await enqueueOmsJob(
        "verify_order",
        { orderId: order.id, input },
        { dedupeKey: `verify:${order.id}:${input.dikonfirmasi_at}` },
      );
      await addSystemNote(order.conversationId, `Verifikasi order ${order.nomor} sedang diproses ulang ke OMS.`);
      after(() => processOutbox().catch((err) => console.error("[oms] outbox kick failed:", (err as Error).message)));
      revalidatePath("/pesan");
      return "OMS belum merespons. Verifikasi disimpan di antrian dan akan dicoba ulang otomatis.";
    }
  });
}

/**
 * Re-sends a failed checkout with its original external_id. Safe when the
 * earlier attempt timed out but did reach OMS: OMS returns that order instead
 * of creating a second one.
 */
export async function retryOmsCheckout(_: ActionState, fd: FormData) {
  return run(async () => {
    const me = await requirePermission("pesan");
    if (!omsConfigured()) throw new Error("OMS belum dikonfigurasi. Isi OMS_BASE_URL dan OMS_API_KEY.");
    const checkoutId = Number(fd.get("checkoutId"));
    const claimed = await db.omsCheckout.updateMany({
      where: { id: checkoutId, status: "failed" },
      data: { status: "pending", lastError: null },
    });
    if (!claimed.count) return "Pesanan ini sudah diproses atau sedang dicoba ulang.";
    const row = await db.omsCheckout.findUniqueOrThrow({ where: { id: checkoutId } });
    await addSystemNote(row.conversationId, `Pesanan dicoba ulang ke OMS oleh ${me.name}.`);
    await enqueueCheckoutSend(row.id);
    after(() => processOutbox().catch((e) => console.error("[oms] outbox kick failed:", (e as Error).message)));
    revalidatePath("/pesan");
    return "Pesanan dicoba ulang ke OMS. Nomor order muncul setelah OMS merespons.";
  });
}

export async function refreshOmsOrder(_: ActionState, fd: FormData) {
  return run(async () => {
    await requirePermission("pesan");
    const orderId = Number(fd.get("orderId"));
    try {
      const order = await syncOrder(orderId);
      revalidatePath("/pesan");
      return `Status ${order.nomor}: ${order.status}.`;
    } catch (e) {
      throw new Error(friendlyOmsError(e));
    }
  });
}

export async function markLeadFailed(_: ActionState, fd: FormData) {
  return run(async () => {
    await requirePermission("pesan");
    const conversationId = Number(fd.get("conversationId"));
    await omsMarkFailed(conversationId);
    after(() => processOutbox().catch((e) => console.error("[oms] outbox kick failed:", (e as Error).message)));
    revalidatePath("/pesan");
    return "Lead ditandai gagal di OMS.";
  });
}
