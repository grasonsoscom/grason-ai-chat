// HTTP client for OMS GRASON, contract cs-ai.v2 (grasonsoscom/grason-oms: docs/api-contract/cs-ai.v2.yaml).
// Pure: no database access, so it can be unit tested. DB wiring lives in oms-sync.ts.
import { createHmac, timingSafeEqual } from "crypto";
import type { CodQuote, Segment } from "./promo";

export type LeadStatus = "baru" | "direspon" | "follow_up" | "closing" | "gagal";
export type OrderStatus = "baru" | "terverifikasi" | "di_gudang" | "dikirim" | "terkirim" | "batal" | "rts";
export type PaymentMethod = "cod" | "transfer";

export type NewLead = {
  external_id: string;
  no_wa: string;
  nama?: string;
  masuk_at: string;
  sku_ditanya?: string;
  kanal?: "click_to_whatsapp" | "landing_page" | "organik" | "lainnya";
  campaign_id?: string | null;
  adset_id?: string | null;
  ad_id?: string | null;
  segmen?: Segment;
  catatan?: string;
};

export type LeadUpdate = {
  status?: Exclude<LeadStatus, "closing">; // closing only happens through an order
  respon_pertama_at?: string;
  handover?: { alasan: string; terjadi_at?: string };
  catatan?: string;
};

export type Lead = {
  id: string; external_id: string; no_wa: string; nama: string | null;
  agen: "cs_ai" | "cs_manusia"; status: LeadStatus; handover: boolean;
  masuk_at: string; respon_pertama_at: string | null; segmen: Segment | null;
};

export type Address = { alamat: string; kelurahan?: string; kecamatan?: string; kota: string; provinsi: string; kode_pos?: string };

export type NewOrder = {
  external_id: string;
  lead_id: string;
  metode_bayar: PaymentMethod;
  penerima: { nama: string; no_wa: string };
  alamat: Address;
  items: { sku: string; qty: number }[];
  ongkir: number;
  diskon?: number;
  subsidi_ongkir: number;
  biaya_cod: number;
  subsidi_admin_cod: number;
  total: number;
  segmen?: Segment;
  catatan?: string;
};

export type Order = {
  id: string; nomor: string; order_group_id: string; external_id: string | null; lead_id: string | null;
  entitas: "SSR" | "FHI"; status: OrderStatus; metode_bayar: PaymentMethod; perlu_verifikasi_manusia?: boolean;
  subtotal: number; diskon: number; ongkir: number; subsidi_ongkir: number; biaya_cod: number;
  subsidi_admin_cod: number; total: number; nilai_cod: number; segmen: Segment | null;
  items: { sku: string; nama: string; qty: number; harga_satuan: number; diskon: number; subtotal: number }[];
  pengiriman: { kurir: string; resi: string; status_kurir?: string | null } | null;
  dibuat_at: string; terverifikasi_at?: string | null;
};

export type Checkout = { order_group_id: string; external_id: string; orders: Order[] };
export type Stock = { sku: string; nama: string; tipe: "satuan" | "paket"; tersedia: number; hari_cover?: number | null; diperbarui_at: string };
export type Price = { sku: string; nama: string; tipe: "satuan" | "paket"; entitas: "SSR" | "FHI"; harga_jual: number; komponen?: { sku: string; qty: number }[] };

export type OrderStatusEvent = {
  event_id: string;
  jenis: "order.status_changed";
  terjadi_at: string;
  data: {
    order_id: string; nomor: string; order_group_id: string;
    checkout_external_id?: string | null; lead_id?: string | null; lead_external_id?: string | null;
    status_sebelum: OrderStatus | null; status: OrderStatus;
    alasan?: string | null; kurir?: string | null; resi?: string | null; percobaan_antar?: number | null;
  };
};

/** Stable external_id values. They must never change for the same record. */
export const leadExternalId = (conversationId: number) => `conv-${conversationId}`;
export const conversationIdFromLead = (externalId: string | null | undefined) => {
  const m = /^conv-(\d+)$/.exec(externalId ?? "");
  return m ? Number(m[1]) : null;
};

export function omsConfigured() {
  return Boolean(process.env.OMS_BASE_URL && process.env.OMS_API_KEY);
}

/** Indonesian text per OMS error code, shown to staff in system notes. */
const ERROR_TEXT: Record<string, string> = {
  validasi_gagal: "Data yang dikirim ke OMS tidak valid",
  tidak_terautentikasi: "API key OMS salah atau sudah dicabut",
  tidak_diizinkan: "API key OMS tidak punya izin untuk aksi ini",
  tidak_ditemukan: "Data tidak ditemukan di OMS",
  lead_tidak_ditemukan: "Lead tidak ditemukan di OMS",
  closing_lewat_order: "Status closing hanya bisa lewat order",
  status_tidak_sesuai: "Status di OMS tidak sesuai untuk perubahan ini",
  stok_tidak_cukup: "Stok tidak cukup",
  sku_tidak_dikenal: "SKU tidak dikenal di OMS",
  produk_nonaktif: "Produk nonaktif di OMS",
  total_tidak_cocok: "Total tidak cocok dengan hitungan OMS (cek harga di GET /prices)",
  rincian_tidak_valid: "Rincian ongkir/biaya COD tidak valid",
  nilai_cod_tidak_cocok: "Nilai COD yang dikonfirmasi tidak sama dengan nilai COD order",
  perlu_verifikasi_manusia: "Pelanggan punya riwayat RTS; verifikasi harus oleh CS manusia",
  terlalu_banyak_permintaan: "Terlalu banyak permintaan ke OMS",
};

export class OmsError extends Error {
  constructor(
    readonly status: number,
    readonly kode: string,
    message: string,
    readonly detail?: unknown,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "OmsError";
  }
}

export class OmsNotConfiguredError extends Error {
  constructor() {
    super("Integrasi OMS belum dikonfigurasi. Isi OMS_BASE_URL dan OMS_API_KEY.");
  }
}

function describe(kode: string, pesan: string | undefined, detail: unknown, retryAfter?: number) {
  let text = ERROR_TEXT[kode] ?? pesan ?? `Galat OMS (${kode})`;
  if (kode === "stok_tidak_cukup" && Array.isArray(detail)) {
    text += ": " + detail.map((d: { sku?: string; diminta?: number; tersedia?: number }) => `${d.sku} diminta ${d.diminta}, tersedia ${d.tersedia}`).join("; ");
  } else if (kode === "total_tidak_cocok" && detail && typeof detail === "object") {
    const d = detail as { total_dikirim?: number; total_oms?: number };
    if (d.total_oms !== undefined) text += `: dikirim ${d.total_dikirim}, OMS ${d.total_oms}`;
  } else if (kode === "validasi_gagal" && Array.isArray(detail)) {
    text += ": " + detail.map((d: { field?: string; pesan?: string }) => `${d.field} (${d.pesan})`).join(", ");
  } else if (kode === "terlalu_banyak_permintaan" && retryAfter) {
    text += `. Coba lagi dalam ${retryAfter} detik`;
  }
  return text + ".";
}

// Wait and retry once on 429 when OMS asks for a short pause; longer waits are reported.
const MAX_RETRY_WAIT_S = 10;

type Options = { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> };

async function request<T>(method: string, path: string, body?: unknown, opts: Options = {}, retried = false): Promise<T> {
  const base = process.env.OMS_BASE_URL?.replace(/\/+$/, "");
  const key = process.env.OMS_API_KEY;
  if (!base || !key) throw new OmsNotConfiguredError();
  const doFetch = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${base}${path}`, {
      method,
      headers: { "X-Api-Key": key, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new OmsError(0, "tidak_terhubung", "Tidak dapat terhubung ke OMS. Cek OMS_BASE_URL atau koneksi.");
  }
  const json = (await res.json().catch(() => null)) as { error?: { kode?: string; pesan?: string; detail?: unknown } } | null;
  if (res.ok) return json as T;

  const retryHeader = Number(res.headers.get("retry-after"));
  const retryAfter = Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : undefined;
  if (res.status === 429 && !retried && retryAfter !== undefined && retryAfter <= MAX_RETRY_WAIT_S) {
    await (opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(retryAfter * 1000);
    return request<T>(method, path, body, opts, true);
  }
  const kode = json?.error?.kode ?? (res.status === 429 ? "terlalu_banyak_permintaan" : `http_${res.status}`);
  const detail = json?.error?.detail;
  throw new OmsError(res.status, kode, describe(kode, json?.error?.pesan, detail, retryAfter), detail, retryAfter);
}

const enc = encodeURIComponent;

export const oms = {
  createLead: (lead: NewLead, o?: Options) => request<Lead>("POST", "/leads", lead, o),
  updateLead: (id: string, patch: LeadUpdate, o?: Options) => request<Lead>("PATCH", `/leads/${enc(id)}`, patch, o),
  prices: (o?: Options) => request<{ data: Price[] }>("GET", "/prices", undefined, o).then((r) => r.data),
  stock: (skus: string[] = [], o?: Options) =>
    request<{ data: Stock[] }>("GET", `/stock${skus.length ? `?sku=${enc(skus.join(","))}` : ""}`, undefined, o).then((r) => r.data),
  createOrder: (order: NewOrder, o?: Options) => request<Checkout>("POST", "/orders", order, o),
  verifyOrder: (id: string, v: { dikonfirmasi_at: string; nilai_cod_dikonfirmasi: number; catatan?: string }, o?: Options) =>
    request<Order>("POST", `/orders/${enc(id)}/verifikasi`, v, o),
  getOrder: (id: string, o?: Options) => request<Order>("GET", `/orders/${enc(id)}`, undefined, o),
};

/**
 * Price breakdown for POST /orders. COD amounts come from `codQuote` (promo.ts) so OMS
 * sees the same total the customer was told; transfer orders carry no COD fee or subsidy.
 * OMS checks total = subtotal − diskon + ongkir − subsidi_ongkir + biaya_cod − subsidi_admin_cod.
 */
export function orderAmounts(method: PaymentMethod, price: number, ongkir: number, quote?: CodQuote) {
  if (method === "transfer") {
    return { ongkir, subsidi_ongkir: 0, biaya_cod: 0, subsidi_admin_cod: 0, total: price + ongkir };
  }
  if (!quote) throw new Error("Order COD butuh rincian codQuote.");
  return {
    ongkir,
    subsidi_ongkir: quote.shippingSubsidy,
    biaya_cod: quote.codFee,
    subsidi_admin_cod: quote.adminSubsidy,
    total: quote.total,
  };
}

const WEBHOOK_TOLERANCE_S = 300;

/** X-Oms-Signature = "sha256=" + HMAC-SHA256(secret, "<X-Oms-Timestamp>.<raw body>"), within 5 minutes. */
export function verifyOmsSignature(secret: string, timestamp: string | null, rawBody: string, signature: string | null, nowS = Date.now() / 1000) {
  const ts = Number(timestamp);
  if (!timestamp || !Number.isFinite(ts) || Math.abs(nowS - ts) > WEBHOOK_TOLERANCE_S) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`);
  const got = Buffer.from(signature ?? "");
  return expected.length === got.length && timingSafeEqual(expected, got);
}
