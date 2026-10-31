// Customer-facing messages for OMS order events. Numbers always come from the
// OMS response/event; this module never calculates totals.
import { formatIDR } from "../format";
import type { EventStatusOrder, Order } from "./types";

export function orderSummaryText(orders: Order[], auto = false): string {
  const lines = orders.map((order, index) => {
    const payment =
      order.metode_bayar === "cod" ? `COD ${formatIDR(order.nilai_cod)}` : `Transfer ${formatIDR(order.total)}`;
    return `${index + 1}) ${order.nomor} — total ${formatIDR(order.total)}, ${payment}`;
  });
  const split =
    orders.length > 1
      ? "\nPesanan ini terdiri dari dua paket terpisah, jadi akan ada dua pengiriman dan dua tagihan."
      : "";
  const closing = auto
    ? "Pesanan akan segera diproses. Kami kabari lagi kalau ada update pengiriman."
    : "Mohon konfirmasi alamat lengkap dan kesediaan bayar. Staf kami akan memprosesnya.";

  return ["Pesanan kamu sudah dibuat:", ...lines, `${split}${closing}`]
    .join("\n")
    .trim();
}

/** Local order fields that enrich follow-ups; amounts still come from OMS. */
export type FollowupOrder = { metodeBayar: string; nilaiCod: number };

function codLine(order?: FollowupOrder) {
  return order?.metodeBayar === "cod" && order.nilaiCod > 0
    ? ` Mohon siapkan uang ${formatIDR(order.nilaiCod)} untuk dibayar ke kurir saat paket tiba ya.`
    : "";
}

export function orderFollowupText(event: EventStatusOrder, order?: FollowupOrder): string | null {
  const { status, alasan, nomor, kurir, resi } = event.data;
  const shipping = [kurir, resi ? `resi ${resi}` : null].filter(Boolean).join(", ");

  // Specific reasons win over the generic status: a failed delivery can still
  // carry status "dikirim" when the courier reports the attempt.
  if (alasan === "gagal_antar") {
    return `Kurir belum berhasil mengantar pesanan ${nomor}${resi ? ` (resi ${resi})` : ""}. Kami akan bantu cek jadwal pengantaran ulang.`;
  }
  if (alasan === "cod_ditolak") {
    return `Pesanan ${nomor} dikembalikan karena COD ditolak. Tim kami akan menghubungi kamu untuk konfirmasi.`;
  }
  if (alasan === "dibatalkan_pembeli" || status === "batal") {
    return `Pesanan ${nomor} sudah dibatalkan.`;
  }
  if (alasan === "resi_terbit" || status === "dikirim") {
    return `Kabar baik! Paket pesanan ${nomor} sudah dikirim${shipping ? ` (${shipping})` : ""}.${codLine(order)}`;
  }
  if (status === "terkirim") {
    return `Pesanan ${nomor} sudah diterima. Terima kasih sudah berbelanja!`;
  }
  if (status === "rts") {
    return `Paket ${nomor} sedang dalam proses pengembalian (RTS). Tim kami akan menghubungi kamu.`;
  }
  return null;
}

/** Sent about two days after shipping while a COD order is still on the way. */
export function codReminderText(nomor: string, nilaiCod: number, resi?: string | null): string {
  return `Halo! Paket pesanan ${nomor}${resi ? ` (resi ${resi})` : ""} sedang dalam perjalanan dan kemungkinan tiba dalam 1–2 hari. Mohon siapkan uang ${formatIDR(nilaiCod)} untuk pembayaran COD ke kurir ya. Terima kasih!`;
}

const STATUS_LABEL: Record<string, string> = {
  baru: "baru dibuat, menunggu konfirmasi",
  terverifikasi: "sudah dikonfirmasi, menunggu diproses gudang",
  di_gudang: "sedang dikemas di gudang",
  dikirim: "sudah dikirim",
  terkirim: "sudah diterima",
  batal: "dibatalkan",
  rts: "dalam proses pengembalian (RTS)",
};

export type LookupOrder = {
  nomor: string;
  status: string;
  metodeBayar: string;
  total: number;
  nilaiCod: number;
  pengirimanJson: string | null;
  createdAt: Date;
};

/** AI context for "cek pesanan saya": only orders of this conversation, numbers from OMS. */
export function orderLookupContext(orders: LookupOrder[]): string {
  const lines = orders.map((o) => {
    let kurir = "";
    let resi = "";
    try {
      const p = o.pengirimanJson ? (JSON.parse(o.pengirimanJson) as { kurir?: string; resi?: string }) : {};
      kurir = p.kurir ?? "";
      resi = p.resi ?? "";
    } catch {
      // Unreadable shipping JSON: answer without courier details.
    }
    const pay = o.metodeBayar === "cod" ? `COD ${formatIDR(o.nilaiCod)}` : `transfer ${formatIDR(o.total)}`;
    const ship = resi ? `, kurir ${kurir || "-"} resi ${resi}` : "";
    return `- ${o.nomor} (dibuat ${o.createdAt.toISOString().slice(0, 10)}): ${STATUS_LABEL[o.status] ?? o.status}, ${pay}${ship}`;
  });
  return [
    "Pelanggan menanyakan pesanannya. Data pesanan nomor WA ini dari sistem (paling baru di atas):",
    ...lines,
    "Jawab dari data ini saja. Jangan mengarang status, resi, atau estimasi tiba. Jika pelanggan menanyakan pesanan lain atau datanya tidak ada, katakan staf akan mengecek.",
  ].join("\n");
}
