// Cancel / address change requested by the buyer over WhatsApp (cs-ai.v3,
// OMS decision 0008). Every change needs an explicit confirmation in chat.
//
// The flow is stateless: each step is recognised from a marker phrase in the
// previous AI message, and a not-yet-confirmed new address waits in a system
// note (system notes are never sent to the customer or the model).
//
//   cancel:  request -> "… Balas BATAL untuk konfirmasi" -> "batal" -> OMS batal
//   address: request -> "… kirim alamat lengkap yang baru …" -> address
//            -> "… Balas YA untuk menyimpan alamat baru" -> "ya" -> OMS alamat
//
// Orders already at the warehouse, an address in another city (ongkir would
// change), and any OMS error go to staff.
import { generateText } from "../ai";
import { extractJson } from "../ai-order";
import { db } from "../db";
import { formatIDR } from "../format";
import { addSystemNote, deliver } from "../outbound";
import { emitWebhook } from "../webhook";
import { cancelOrder, correctOrderAddress } from "./client";
import { detectOrderRequest, OPEN_ORDER_STATUSES, orderRequestReply } from "./customer-intents";
import { friendlyOmsError } from "./errors";
import { omsOnHandover } from "./lead";
import { applyOrderSnapshot } from "./orders";
import { hasRtRw } from "./rts-risk";
import type { Alamat, OrderBaru } from "./types";

export const CANCEL_CONFIRM = "Balas BATAL untuk konfirmasi";
export const ADDRESS_ASK = "kirim alamat lengkap yang baru";
export const ADDRESS_CONFIRM = "Balas YA untuk menyimpan alamat baru";
const PENDING_PREFIX = "[alamat-baru ";

/** OMS allows cancel and address correction only before Ethix takes the order. */
export const CHANGEABLE_STATUSES = ["baru", "terverifikasi"];

export function isCancelConfirmation(text: string) {
  return /^\s*(ya|iya|y)?[\s,.!]*(batal|batalkan|batalin|dibatalkan)\b/i.test(text);
}

export function isYes(text: string) {
  return /^\s*(ya|iya|y|ok|oke|okey|betul|benar|setuju|simpan|sudah benar)\b/i.test(text);
}

/** "Kota Bandung", "KAB. BANDUNG BARAT" -> "bandung", "bandung barat". */
export function normCity(kota: string) {
  return kota
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(kota|kabupaten|kab|adm|administrasi)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Missing parts of a new address, using the same rule as the RTS check. */
export function missingAddressParts(a: Partial<Alamat>) {
  return [
    a.alamat?.trim() ? null : "nama jalan dan nomor rumah",
    a.alamat && hasRtRw(a.alamat) ? null : "RT/RW",
    a.kecamatan?.trim() ? null : "kecamatan",
    a.kota?.trim() ? null : "kota/kabupaten",
    a.provinsi?.trim() ? null : "provinsi",
    /^\d{5}$/.test(a.kode_pos?.trim() ?? "") ? null : "kode pos",
  ].filter(Boolean) as string[];
}

export function formatAddress(a: Alamat) {
  return [a.alamat, a.kelurahan, a.kecamatan, a.kota, a.provinsi, a.kode_pos].filter(Boolean).join(", ");
}

type MirrorOrder = { id: number; omsOrderId: string; nomor: string; status: string; metodeBayar: string; nilaiCod: number; total: number; checkoutId: number };

async function escalate(conversationId: number, note: string, reply: string) {
  await db.conversation.update({ where: { id: conversationId }, data: { mode: "eskalasi", modeChangedAt: new Date() } });
  await addSystemNote(conversationId, note);
  await omsOnHandover(conversationId, note.slice(0, 200));
  await deliver(conversationId, reply, "ai");
  await emitWebhook("conversation.escalated", { conversation_id: conversationId, keyword: "order_change" });
}

/** The conversation's order whose number the previous AI message named. */
async function orderNamedIn(conversationId: number, text: string): Promise<MirrorOrder | null> {
  const orders = await db.omsOrder.findMany({ where: { conversationId }, orderBy: { createdAt: "desc" }, take: 10 });
  return orders.find((o) => text.includes(o.nomor)) ?? null;
}

async function checkoutAddress(checkoutId: number): Promise<Alamat | null> {
  const row = await db.omsCheckout.findUnique({ where: { id: checkoutId }, select: { payload: true } });
  try {
    return row ? (JSON.parse(row.payload) as OrderBaru).alamat : null;
  } catch {
    return null;
  }
}

async function extractAddress(text: string): Promise<Partial<Alamat>> {
  const system = [
    "Ambil alamat pengiriman dari pesan pelanggan. Balas HANYA JSON valid tanpa markdown.",
    'Format: {"alamat":"","kelurahan":"","kecamatan":"","kota":"","provinsi":"","kode_pos":""}',
    "- alamat = nama jalan, nomor rumah, RT/RW, patokan (bukan nama kota).",
    "- Jangan mengarang. Kosongkan bagian yang tidak disebut.",
  ].join("\n");
  try {
    const raw = await generateText(system, [{ role: "user", text }], { maxTokens: 400, temperature: 0 });
    const p = extractJson(raw) as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    return {
      alamat: s(p.alamat),
      kelurahan: s(p.kelurahan) || undefined,
      kecamatan: s(p.kecamatan) || undefined,
      kota: s(p.kota),
      provinsi: s(p.provinsi),
      kode_pos: s(p.kode_pos) || undefined,
    };
  } catch {
    return {};
  }
}

function pendingNote(nomor: string, alamat: Alamat) {
  return `${PENDING_PREFIX}${nomor}] ${JSON.stringify(alamat)}`;
}

async function pendingAddress(conversationId: number, nomor: string): Promise<Alamat | null> {
  const note = await db.message.findFirst({
    where: { conversationId, sender: "system", text: { startsWith: `${PENDING_PREFIX}${nomor}]` } },
    orderBy: { createdAt: "desc" },
  });
  if (!note) return null;
  try {
    return JSON.parse(note.text.slice(note.text.indexOf("]") + 1).trim()) as Alamat;
  } catch {
    return null;
  }
}

async function doCancel(conversationId: number, order: MirrorOrder) {
  if (!CHANGEABLE_STATUSES.includes(order.status)) {
    await escalate(
      conversationId,
      `Pelanggan mengonfirmasi pembatalan ${order.nomor}, tetapi status sudah ${order.status}. Proses di OMS/Ethix lalu kabari pelanggan.`,
      orderRequestReply("cancel", order.nomor),
    );
    return;
  }
  try {
    const updated = await cancelOrder(order.omsOrderId, "Pembeli membatalkan lewat chat WhatsApp");
    // Sends "Pesanan … sudah dibatalkan." and a system note; the OMS webhook
    // for the same change arrives later and is ignored as stale.
    await applyOrderSnapshot(order.id, updated, "chat");
  } catch (e) {
    await escalate(
      conversationId,
      `Pembatalan otomatis ${order.nomor} gagal: ${friendlyOmsError(e)} Proses manual di OMS.`,
      `Maaf kak, pesanan ${order.nomor} belum bisa dibatalkan otomatis. Staf kami akan membantu ya.`,
    );
  }
}

async function doCorrectAddress(conversationId: number, order: MirrorOrder, alamat: Alamat) {
  try {
    await correctOrderAddress(order.omsOrderId, { alamat });
    const row = await db.omsCheckout.findUnique({ where: { id: order.checkoutId }, select: { payload: true } });
    if (row) {
      try {
        const payload = JSON.parse(row.payload) as OrderBaru;
        await db.omsCheckout.update({ where: { id: order.checkoutId }, data: { payload: JSON.stringify({ ...payload, alamat }) } });
      } catch {
        // The OMS order is updated; a broken local payload only affects reports.
      }
    }
    await addSystemNote(conversationId, `Alamat order ${order.nomor} diperbarui atas permintaan pelanggan: ${formatAddress(alamat)}.`);
    await deliver(conversationId, `Siap kak, alamat pesanan ${order.nomor} sudah kami perbarui ya.`, "ai");
  } catch (e) {
    await escalate(
      conversationId,
      `Koreksi alamat otomatis ${order.nomor} gagal: ${friendlyOmsError(e)} Alamat baru: ${formatAddress(alamat)}.`,
      `Maaf kak, alamat pesanan ${order.nomor} belum bisa diubah otomatis. Staf kami akan membantu ya.`,
    );
  }
}

/**
 * Handles one step of a cancel / address change. Returns true when it replied
 * (the normal AI reply must then be skipped).
 */
export async function handleOrderChange(conversationId: number, lastIn: string, lastAi: string): Promise<boolean> {
  // Step 2 of cancel: the buyer answers "BATAL".
  if (lastAi.includes(CANCEL_CONFIRM)) {
    const order = await orderNamedIn(conversationId, lastAi);
    if (order && isCancelConfirmation(lastIn)) {
      await doCancel(conversationId, order);
      return true;
    }
  }

  // Step 3 of address change: the buyer answers "ya" to the new address.
  if (lastAi.includes(ADDRESS_CONFIRM)) {
    const order = await orderNamedIn(conversationId, lastAi);
    const alamat = order ? await pendingAddress(conversationId, order.nomor) : null;
    if (order && alamat && isYes(lastIn)) {
      if (!CHANGEABLE_STATUSES.includes(order.status)) {
        await escalate(
          conversationId,
          `Pelanggan minta alamat ${order.nomor} diganti, tetapi status sudah ${order.status}. Alamat baru: ${formatAddress(alamat)}.`,
          orderRequestReply("change_address", order.nomor),
        );
      } else {
        await doCorrectAddress(conversationId, order, alamat);
      }
      return true;
    }
  }

  // Step 2 of address change: the buyer sends the new address.
  if (lastAi.includes(ADDRESS_ASK)) {
    const order = await orderNamedIn(conversationId, lastAi);
    if (order && CHANGEABLE_STATUSES.includes(order.status)) {
      const found = await extractAddress(lastIn);
      const missing = missingAddressParts(found);
      if (missing.length) {
        await deliver(
          conversationId,
          `Alamatnya belum lengkap kak (${missing.join(", ")} belum ada). Mohon ${ADDRESS_ASK} untuk pesanan ${order.nomor} sekali lagi dalam satu pesan ya.`,
          "ai",
        );
        return true;
      }
      const alamat = found as Alamat;
      const current = await checkoutAddress(order.checkoutId);
      if (current && normCity(current.kota) !== normCity(alamat.kota)) {
        await escalate(
          conversationId,
          `Pelanggan minta alamat ${order.nomor} pindah kota (${current.kota} -> ${alamat.kota}). Ongkir dan COD bisa berubah; mungkin perlu batal + order baru. Alamat baru: ${formatAddress(alamat)}.`,
          `Alamat barunya beda kota dengan pesanan ${order.nomor}, jadi ongkirnya perlu dihitung ulang. Staf kami akan bantu ya kak.`,
        );
        return true;
      }
      await addSystemNote(conversationId, pendingNote(order.nomor, alamat));
      await deliver(
        conversationId,
        `Alamat baru untuk pesanan ${order.nomor}:\n${formatAddress(alamat)}\n\nSudah benar kak? ${ADDRESS_CONFIRM}.`,
        "ai",
      );
      return true;
    }
  }

  // Step 1: a new cancel / address-change request on an open order.
  const request = detectOrderRequest(lastIn);
  if (!request) return false;
  const open = await db.omsOrder.findFirst({
    where: { conversationId, status: { in: OPEN_ORDER_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
  if (!open) return false;

  const label = request === "cancel" ? "pembatalan" : "perubahan alamat";
  if (!CHANGEABLE_STATUSES.includes(open.status)) {
    await escalate(
      conversationId,
      `Pelanggan meminta ${label} pesanan ${open.nomor} (status ${open.status}). Proses di OMS lalu kabari pelanggan.`,
      orderRequestReply(request, open.nomor),
    );
    return true;
  }
  if (request === "cancel") {
    const pay = open.metodeBayar === "cod" ? `COD ${formatIDR(open.nilaiCod)}` : `total ${formatIDR(open.total)}`;
    await deliver(conversationId, `Kakak mau membatalkan pesanan ${open.nomor} (${pay})? ${CANCEL_CONFIRM} ya.`, "ai");
  } else {
    await deliver(
      conversationId,
      `Siap kak, silakan ${ADDRESS_ASK} untuk pesanan ${open.nomor} dalam satu pesan ya (nama jalan dan nomor rumah, RT/RW, kelurahan, kecamatan, kota, provinsi, dan kode pos).`,
      "ai",
    );
  }
  await addSystemNote(conversationId, `Pelanggan meminta ${label} pesanan ${open.nomor}; menunggu konfirmasi pelanggan.`);
  return true;
}
