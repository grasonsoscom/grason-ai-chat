// Maps OMS errors to messages for staff. Never show error.pesan verbatim to
// customers (section 7 of the integration guide).
import { OmsApiError, OmsNetworkError, OmsNotConfiguredError } from "./client";

type StokDetail = { sku?: string; diminta?: number; tersedia?: number };

export function friendlyOmsError(e: unknown): string {
  if (e instanceof OmsNotConfiguredError) return e.message;
  if (e instanceof OmsNetworkError) return "OMS sedang tidak dapat dihubungi. Permintaan akan dicoba ulang.";

  if (e instanceof OmsApiError) {
    switch (e.kode) {
      case "validasi_gagal":
        return "Data belum lengkap atau tidak valid. Periksa kembali isiannya.";
      case "tidak_terautentikasi":
        return "API key OMS tidak valid atau sudah dicabut. Hubungi admin.";
      case "tidak_diizinkan":
        return "API key OMS tidak punya izin untuk aksi ini. Hubungi tim OMS.";
      case "tidak_ditemukan":
      case "lead_tidak_ditemukan":
        return "Data tidak ditemukan di OMS. Muat ulang lalu coba lagi.";
      case "status_tidak_sesuai":
      case "status_berubah":
      case "lead_sudah_closing":
      case "closing_lewat_order":
        return "Status sudah berubah atau perubahan tidak diizinkan. Muat ulang data terbaru.";
      case "total_tidak_cocok":
        return "Total order tidak cocok dengan harga aktif OMS. Muat ulang katalog lalu buat ulang order.";
      case "rincian_tidak_valid":
        return "Rincian subsidi/COD tidak valid. Periksa metode bayar, ongkir, dan segmen pelanggan.";
      case "diskon_melebihi_subtotal":
        return "Diskon melebihi subtotal order.";
      case "stok_tidak_cukup": {
        const detail = Array.isArray(e.detail) ? (e.detail as StokDetail[]) : [];
        const parts = detail
          .map((d) => `${d.sku ?? "SKU"} tersedia ${d.tersedia ?? "?"}`)
          .filter(Boolean)
          .join(", ");
        return `Stok tidak cukup${parts ? ` (${parts})` : ""}. Tawarkan jumlah yang tersedia atau produk lain.`;
      }
      case "sku_tidak_dikenal":
      case "produk_nonaktif":
        return "Produk tidak aktif atau SKU tidak dikenal. Muat ulang katalog.";
      case "perlu_verifikasi_manusia":
        return "Pelanggan punya riwayat RTS. Verifikasi harus dilakukan CS manusia.";
      case "nilai_cod_tidak_cocok":
        return "Nilai COD tidak cocok dengan OMS. Konfirmasi ulang ke pembeli memakai angka dari OMS.";
      case "terlalu_banyak_permintaan":
        return "Terlalu banyak permintaan ke OMS. Coba lagi sebentar.";
      default:
        return `OMS menolak permintaan (${e.kode}).`;
    }
  }

  return (e as Error)?.message || "Terjadi kesalahan pada integrasi OMS.";
}
