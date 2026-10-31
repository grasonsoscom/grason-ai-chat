// Keyword detection for order requests that the AI must not handle alone.
// Cancel and address changes are not in the CS-AI contract, so they go to
// staff; order-status questions are answered from the local order mirror.

export type OrderRequest = "cancel" | "change_address";

// "gak jadi" alone is too loose ("gak jadi masalah"), so it needs a verb.
const CANCEL = /\b(batal(kan|in)?|dibatalkan|cancel|cancell?ed|(gak|ga|nggak|enggak|tidak|ngga|gk) jadi (pesan|order|beli|ambil))\b/i;
const ADDRESS =
  /\b((ganti|ubah|ubahin|gantiin|ralat|revisi|pindah|koreksi)\s+(alamat|alamatnya)|(alamat|alamatnya)\s+(salah|keliru|berubah|pindah|diganti|diubah|ganti|ubah))\b/i;
const NEGATED_CANCEL = /\b(jangan|tidak|nggak|gak|ga)\s+(di)?batal/i;

/** A cancel or address-change request in the customer's latest message, if any. */
export function detectOrderRequest(text: string): OrderRequest | null {
  if (ADDRESS.test(text)) return "change_address";
  if (CANCEL.test(text) && !NEGATED_CANCEL.test(text)) return "cancel";
  return null;
}

const LOOKUP =
  /\b(cek|status|lacak|track(ing)?|resi|no\.?\s*resi)\b.*\b(pesanan|pesenan|orderan|order|paket|kiriman)\b|\b(pesanan|pesenan|orderan|paket|kiriman)(ku| saya| aku| gue| gw)?\b.*\b(sampai mana|dimana|di mana|udah|sudah|kapan|belum)\b|\bkapan (sampai|sampe|datang|dateng|tiba)\b|\bresi(nya)?\b/i;

/** "cek pesanan saya", "paket saya sudah sampai mana?", "resinya berapa?" */
export function isOrderLookup(text: string) {
  return LOOKUP.test(text);
}

export function orderRequestReply(kind: OrderRequest, nomor: string) {
  return kind === "cancel"
    ? `Baik, permintaan pembatalan pesanan ${nomor} sudah kami teruskan ke staf. Mohon tunggu sebentar, staf kami akan segera menghubungi kamu.`
    : `Baik, permintaan perubahan alamat untuk pesanan ${nomor} sudah kami teruskan ke staf. Silakan kirim alamat lengkap yang baru (termasuk RT/RW, kecamatan, dan kode pos) di chat ini ya.`;
}

/** Statuses where staff can still act on a cancel or address change. */
export const OPEN_ORDER_STATUSES = ["baru", "terverifikasi", "di_gudang", "dikirim"];
