// Types for the OMS GRASON contract (docs/oms/cs-ai.v2.yaml; v1 is still
// accepted by OMS). Keep names in snake_case for anything sent to OMS.
import type { Segment } from "../promo-quote";

export type Kanal = "click_to_whatsapp" | "landing_page" | "organik" | "lainnya";
export type Entitas = "SSR" | "FHI";
export type StatusLead = "baru" | "direspon" | "follow_up" | "closing" | "gagal";
export type StatusOrder = "baru" | "terverifikasi" | "di_gudang" | "dikirim" | "terkirim" | "batal" | "rts";
export type MetodeBayar = "cod" | "transfer";

export interface Atribusi {
  kanal?: Kanal;
  campaign_id?: string | null;
  adset_id?: string | null;
  ad_id?: string | null;
}

export interface LeadBaru extends Atribusi {
  external_id: string;
  no_wa: string;
  nama?: string;
  sku_ditanya?: string;
  masuk_at: string;
  segmen?: Segment;
  catatan?: string;
}

export interface HandoverInput {
  alasan: string;
  terjadi_at?: string;
}

export interface UbahLead {
  status?: StatusLead;
  respon_pertama_at?: string;
  handover?: HandoverInput;
  catatan?: string;
}

export interface Lead extends Atribusi {
  id: string;
  external_id: string;
  no_wa: string;
  nama?: string | null;
  agen: "cs_ai" | "cs_manusia";
  status: StatusLead;
  handover: boolean;
  handover_at: string | null;
  masuk_at: string;
  respon_pertama_at: string | null;
  segmen?: Segment | null;
}

export interface Alamat {
  alamat: string;
  kelurahan?: string;
  kecamatan?: string;
  kota: string;
  provinsi: string;
  kode_pos?: string;
}

export interface Penerima {
  nama: string;
  no_wa: string;
}

export interface ItemBaru {
  sku: string;
  qty: number;
}

export interface OrderBaru {
  external_id: string;
  lead_id: string;
  metode_bayar: MetodeBayar;
  penerima: Penerima;
  alamat: Alamat;
  items: ItemBaru[];
  ongkir?: number;
  diskon?: number;
  // v2: the CS AI computes and sends the COD breakdown; OMS validates it.
  subsidi_ongkir?: number;
  biaya_cod?: number;
  subsidi_admin_cod?: number;
  total: number;
  segmen?: Segment;
  catatan?: string;
}

/** cs-ai.v3 PATCH /orders/{id}/alamat. Ongkir and COD stay as they are. */
export interface KoreksiAlamat {
  penerima?: { nama?: string; no_wa?: string };
  alamat: Alamat;
}

export interface Verifikasi {
  dikonfirmasi_at: string;
  nilai_cod_dikonfirmasi: number;
  catatan?: string;
}

export interface ItemOrder {
  sku: string;
  nama: string;
  qty: number;
  harga_satuan: number;
  diskon: number;
  subtotal: number;
}

export interface Pengiriman {
  kurir: string;
  resi: string;
  status_kurir?: string | null;
  percobaan_antar?: number;
  dikirim_at?: string | null;
  diterima_at?: string | null;
}

export interface Order {
  id: string;
  nomor: string;
  order_group_id: string;
  external_id?: string | null;
  lead_id?: string | null;
  entitas: Entitas;
  status: StatusOrder;
  metode_bayar: MetodeBayar;
  perlu_verifikasi_manusia?: boolean;
  subtotal: number;
  diskon: number;
  ongkir: number;
  subsidi_ongkir?: number;
  biaya_cod?: number;
  subsidi_admin_cod?: number;
  total: number;
  nilai_cod: number;
  segmen?: Segment | null;
  items: ItemOrder[];
  pengiriman: Pengiriman | null;
  dibuat_at: string;
  terverifikasi_at: string | null;
}

export interface Checkout {
  order_group_id: string;
  external_id: string;
  orders: Order[];
}

export interface Stok {
  sku: string;
  nama: string;
  tipe: "satuan" | "paket";
  tersedia: number;
  hari_cover?: number | null;
  diperbarui_at: string;
}

export interface Harga {
  sku: string;
  nama: string;
  tipe: "satuan" | "paket";
  entitas: Entitas;
  harga_jual: number;
  komponen?: { sku: string; qty: number }[];
}

export interface ListResponse<T> {
  data: T[];
}

export interface Galat {
  error: {
    kode: string;
    pesan: string;
    detail?: unknown;
  };
}

export interface EventStatusOrder {
  event_id: string;
  jenis: "order.status_changed";
  terjadi_at: string;
  data: {
    order_id: string;
    nomor: string;
    order_group_id: string;
    checkout_external_id?: string | null;
    lead_id?: string | null;
    lead_external_id?: string | null;
    status_sebelum: StatusOrder | null;
    status: StatusOrder;
    alasan?: string | null;
    kurir?: string | null;
    resi?: string | null;
    percobaan_antar?: number | null;
  };
}
