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

export function orderFollowupText(event: EventStatusOrder): string | null {
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
    return `Kabar baik! Paket pesanan ${nomor} sudah dikirim${shipping ? ` (${shipping})` : ""}.`;
  }
  if (status === "terkirim") {
    return `Pesanan ${nomor} sudah diterima. Terima kasih sudah berbelanja!`;
  }
  if (status === "rts") {
    return `Paket ${nomor} sedang dalam proses pengembalian (RTS). Tim kami akan menghubungi kamu.`;
  }
  return null;
}
