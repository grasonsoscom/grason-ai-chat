// AI-driven checkout: extract an order from the conversation, quote shipping,
// ask for confirmation, then create (and optionally verify) the OMS order.
import { generateText, type ChatTurn } from "./ai";
import { formatIDR } from "./format";
import { quoteOngkir, type OngkirQuote } from "./ongkir-quote";
import { customerSegment } from "./promo";
import { orderQuote, regionFromText, type OrderQuote, type Region, type Segment } from "./promo-quote";
import { OmsApiError } from "./oms/client";
import { friendlyOmsError } from "./oms/errors";
import { aiCheckoutExternalId, orderFingerprint } from "./oms/dedupe";
import { isRetryableStatus, normalizePhone } from "./oms/normalize";
import type { OmsCatalog } from "./oms/catalog";
import { autoVerifyCheckout, submitCheckout } from "./oms/orders";
import { enqueueCheckoutSend } from "./oms/queue";
import { processOutbox } from "./oms/outbox";
import type { OrderBaru } from "./oms/types";
import { addSystemNote } from "./outbound";
import { db } from "./db";
import { Prisma } from "@prisma/client";

export type AiOrderDraft = {
  intent: "order" | "confirm" | "cancel" | "other";
  items: { sku: string; qty: number }[];
  nama: string;
  no_wa: string;
  alamat: string;
  kelurahan: string;
  kecamatan: string;
  kota: string;
  provinsi: string;
  kode_pos: string;
  metode_bayar: "cod" | "transfer" | "";
  catatan: string;
  confirmed: boolean;
};

export type AutoOrderPlan = {
  draft: AiOrderDraft;
  missing: string[];
  problems: string[];
  quote: OngkirQuote | null;
  subtotal: number;
  promo: OrderQuote | null;
  ready: boolean;
  segment: Segment;
  region: Region;
};

export function emptyOrderDraft(): AiOrderDraft {
  return {
    intent: "other",
    items: [],
    nama: "",
    no_wa: "",
    alamat: "",
    kelurahan: "",
    kecamatan: "",
    kota: "",
    provinsi: "",
    kode_pos: "",
    metode_bayar: "",
    catatan: "",
    confirmed: false,
  };
}

const ORDER_HINT = /\b(pesan|order|beli|checkout|mau|ambil|cod|transfer|alamat|kirim|nama|konfirmasi|fix|jadi|gas|paket|botol|box)\b/i;

/** Cheap gate to avoid an extra model call for unrelated chat. */
export function looksLikeOrder(text: string) {
  return ORDER_HINT.test(text);
}

function catalogLines(catalog: OmsCatalog) {
  const stock = new Map(catalog.stock.map((s) => [s.sku, s.tersedia]));
  return catalog.prices
    .map((p) => {
      const komponen = p.komponen?.length ? ` | isi: ${p.komponen.map((k) => `${k.sku} x${k.qty}`).join(", ")}` : "";
      return `- ${p.sku} | ${p.nama} | ${p.tipe} | ${formatIDR(p.harga_jual)} | stok ${stock.get(p.sku) ?? "tidak diketahui"}${komponen}`;
    })
    .join("\n");
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("JSON tidak ditemukan.");
  return JSON.parse(text.slice(start, end + 1));
}

function str(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function method(value: unknown): AiOrderDraft["metode_bayar"] {
  const v = typeof value === "string" ? value.toLowerCase() : "";
  return v === "cod" || v === "transfer" ? v : "";
}

function intent(value: unknown): AiOrderDraft["intent"] {
  const v = typeof value === "string" ? value.toLowerCase() : "";
  return v === "order" || v === "confirm" || v === "cancel" ? v : "other";
}

/**
 * Extracts the order draft from the conversation. Returns an empty draft when
 * the model cannot produce valid JSON; callers keep the normal AI reply path.
 */
export async function extractOrderDraft(turns: ChatTurn[], catalog: OmsCatalog): Promise<AiOrderDraft> {
  const transcript = turns
    .slice(-20)
    .map((t) => `${t.role === "user" ? "Pelanggan" : "AI"}: ${t.text}`)
    .join("\n");
  const system = [
    "Kamu adalah mesin ekstraksi data pesanan untuk toko online. Baca percakapan dan balas HANYA JSON valid tanpa markdown.",
    "Katalog OMS (hanya SKU ini yang boleh dipakai):",
    catalogLines(catalog),
    'Format JSON: {"intent":"order|confirm|cancel|other","items":[{"sku":"BSR-01","qty":1}],"nama":"","no_wa":"","alamat":"","kelurahan":"","kecamatan":"","kota":"","provinsi":"","kode_pos":"","metode_bayar":"cod|transfer|","catatan":"","confirmed":false}',
    "Aturan:",
    "- Jangan mengarang data. Kosongkan field yang belum disebut pelanggan.",
    "- Petakan nama produk dan ukuran ke SKU katalog. Contoh: \"Bio Serea isi 2\" -> BSR-P2, \"Kapsul Kutuk Paket isi 3\" -> KKT-P3.",
    "- qty hanya 1-100. Jika pelanggan tidak menyebut qty, isi 1 hanya kalau produknya jelas.",
    "- `confirmed` true HANYA jika pesan terakhir pelanggan menyetujui pembuatan pesanan setelah AI menyebut total/rincian. Kata \"ya/ok\" tanpa konteks itu tetap false.",
    "- `intent` confirm jika pelanggan menyetujui, order jika ingin memesan, cancel jika membatalkan.",
    "- alamat diisi alamat jalan/patokan, bukan nama kota.",
  ].join("\n");

  try {
    const text = await generateText(system, [{ role: "user", text: transcript || "(belum ada pesan)" }], {
      maxTokens: 1600,
      temperature: 0,
    });
    const parsed = extractJson(text) as Record<string, unknown>;
    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
    const valid = new Set(catalog.prices.map((p) => p.sku));
    const items: { sku: string; qty: number }[] = [];
    for (const row of rawItems) {
      if (!row || typeof row !== "object") continue;
      const item = row as { sku?: unknown; qty?: unknown };
      const sku = str(item.sku).toUpperCase();
      const qty = Math.round(Number(item.qty));
      if (!valid.has(sku) || !Number.isInteger(qty) || qty < 1 || qty > 100) continue;
      if (items.some((i) => i.sku === sku)) continue;
      items.push({ sku, qty });
    }
    return {
      intent: intent(parsed.intent),
      items,
      nama: str(parsed.nama),
      no_wa: str(parsed.no_wa),
      alamat: str(parsed.alamat),
      kelurahan: str(parsed.kelurahan),
      kecamatan: str(parsed.kecamatan),
      kota: str(parsed.kota),
      provinsi: str(parsed.provinsi),
      kode_pos: str(parsed.kode_pos),
      metode_bayar: method(parsed.metode_bayar),
      catatan: str(parsed.catatan),
      confirmed: parsed.confirmed === true,
    };
  } catch (e) {
    console.error("[ai-order] extraction failed:", (e as Error).message);
    return emptyOrderDraft();
  }
}

export function missingOrderFields(draft: AiOrderDraft, quote: OngkirQuote | null) {
  const missing: string[] = [];
  if (!draft.items.length) missing.push("produk yang mau dipesan");
  if (!draft.nama) missing.push("nama penerima");
  if (!draft.alamat) missing.push("alamat lengkap (jalan/patokan)");
  if (!draft.kecamatan) missing.push("kecamatan");
  if (!draft.kota) missing.push("kota/kabupaten");
  if (!draft.provinsi) missing.push("provinsi");
  if (!draft.metode_bayar) missing.push("metode bayar (COD atau transfer)");
  if (!quote) missing.push("ongkir (daerah belum bisa dihitung otomatis)");
  return missing;
}

/** Prices the draft with OMS catalog prices and a real shipping quote. */
export async function planAutoOrder(input: {
  draft: AiOrderDraft;
  catalog: OmsCatalog;
  segment: Segment;
}): Promise<AutoOrderPlan> {
  const { draft, catalog, segment } = input;
  const priceBySku = new Map(catalog.prices.map((p) => [p.sku, p]));
  const stockBySku = new Map(catalog.stock.map((s) => [s.sku, s]));
  const problems: string[] = [];
  let subtotal = 0;
  for (const item of draft.items) {
    const price = priceBySku.get(item.sku);
    if (!price) {
      problems.push(`Produk ${item.sku} tidak ada di katalog OMS`);
      continue;
    }
    subtotal += price.harga_jual * item.qty;
    const stock = stockBySku.get(item.sku)?.tersedia;
    if (stock !== undefined && stock < item.qty) {
      problems.push(`Stok ${price.nama} tinggal ${stock}`);
    }
  }

  const quote =
    draft.kota && draft.provinsi
      ? await quoteOngkir({
          kecamatan: draft.kecamatan,
          kota: draft.kota,
          provinsi: draft.provinsi,
          kode_pos: draft.kode_pos,
        })
      : null;
  const region = regionFromText([draft.provinsi, draft.kota, draft.kecamatan].join(" ")) ?? "luar";
  const promo = quote
    ? orderQuote({
        subtotal,
        ongkir: quote.cost,
        diskon: 0,
        metode: draft.metode_bayar || "cod",
        segment,
        region,
      })
    : null;
  const missing = missingOrderFields(draft, quote);
  if (promo && promo.total < 0) problems.push("Total pesanan menjadi negatif; cek diskon/ongkir");
  return {
    draft,
    missing,
    problems,
    quote,
    subtotal,
    promo,
    ready: missing.length === 0 && problems.length === 0 && Boolean(promo) && (promo?.total ?? -1) >= 0,
    segment,
    region,
  };
}

/** Extra system-prompt instructions for the customer-facing reply. */
export function buildOrderContext(plan: AutoOrderPlan, confirmed: boolean) {
  const { draft, quote, promo } = plan;
  if (!draft.items.length && !plan.missing.length) return "";

  const itemLines = draft.items.map((i) => `- ${i.sku} x${i.qty}`);
  const lines = [
    "MODE ORDER OTOMATIS AKTIF. Sistem ini boleh membuat pesanan OMS setelah pelanggan mengonfirmasi. Kamu tetap tidak menghitung angka sendiri; pakai rincian di bawah. Instruksi ini menggantikan aturan sebelumnya yang menyebut staf akan membuatkan pesanan.",
    itemLines.length ? `Item: ${itemLines.join(", ")}` : "Item: belum ada",
    `Penerima: ${draft.nama || "-"} (${draft.no_wa || "nomor WA percakapan"})`,
    `Alamat: ${[draft.alamat, draft.kelurahan, draft.kecamatan, draft.kota, draft.provinsi, draft.kode_pos].filter(Boolean).join(", ") || "-"}`,
    `Metode bayar: ${draft.metode_bayar || "-"}`,
  ];

  if (plan.missing.length) lines.push(`Data yang masih kurang: ${plan.missing.join("; ")}.`);
  if (plan.problems.length) lines.push(`Masalah yang harus disampaikan: ${plan.problems.join("; ")}.`);

  if (quote && promo) {
    lines.push(
      "Rincian dari sistem (boleh disampaikan apa adanya, jangan diubah):",
      `- Subtotal produk: ${formatIDR(plan.subtotal)}`,
      `- Ongkir ${quote.courier} ${quote.service}${quote.etd ? ` (estimasi ${quote.etd})` : ""}: ${formatIDR(quote.cost)} (berat ${quote.weight.toLocaleString("id-ID")} gram, sumber ${quote.source === "rajaongkir" ? "RajaOngkir" : "J&T"})`,
    );
    if (draft.metode_bayar === "cod" || !draft.metode_bayar) {
      lines.push(
        `- Subsidi ongkir: -${formatIDR(promo.shippingSubsidy)}`,
        `- Biaya COD 3%: ${formatIDR(promo.codFee)}`,
        `- Subsidi admin COD: -${formatIDR(promo.adminSubsidy)}`,
      );
    }
    lines.push(`- Total: ${formatIDR(promo.total)}`);
  }

  const addressComplete = Boolean(draft.alamat && draft.kecamatan && draft.kota && draft.provinsi);
  lines.push(
    "Aturan balasan:",
    "- Jika data masih kurang: tanyakan hanya yang kurang dengan ramah, jangan membuat pesanan.",
    ...(quote
      ? []
      : [
          addressComplete
            ? "- Ongkir belum tersedia meski alamat sudah lengkap: jangan membuat pesanan; sampaikan staf akan cek ongkirnya."
            : "- Ongkir belum bisa dihitung karena alamat/kecamatan/kota belum lengkap: minta data itu dulu; jangan bilang akan dicek tim.",
        ]),
    "- Jika ada masalah stok/produk: jangan membuat pesanan; tawarkan produk atau jumlah lain.",
    "- Jika data lengkap dan pelanggan BELUM konfirmasi: sampaikan total di atas, lalu minta konfirmasi dengan kalimat 'Balas YA untuk membuat pesanan.' Jangan bilang pesanan sudah dibuat.",
    "- Jika pelanggan SUDAH konfirmasi: balas singkat bahwa pesanan sedang dibuat oleh sistem dan nomor pesanan akan dikirim setelah selesai. Jangan mengarang nomor order.",
    "- Jangan menambah diskon, ongkir, produk, atau janji pengiriman di luar rincian ini.",
  );
  if (confirmed && plan.ready) {
    lines.push("Pelanggan sudah mengonfirmasi dan data lengkap. Sistem akan membuat pesanan setelah balasan ini terkirim.");
  }
  return lines.join("\n");
}

export type AutoOrderResult = {
  ok: boolean;
  duplicate?: boolean;
  queued?: boolean;
  /** Staff-facing detail; never send it to the customer as-is. */
  message: string;
  /** True when a system note with the detail was already written. */
  noted?: boolean;
  checkoutId?: number;
};

/** Creates the OMS checkout for a ready, confirmed plan. */
export async function createAutoOrder(input: {
  conversationId: number;
  plan: AutoOrderPlan;
}): Promise<AutoOrderResult> {
  const { conversationId, plan } = input;
  if (!plan.ready || !plan.quote || !plan.promo) {
    return { ok: false, message: "Data pesanan belum lengkap." };
  }
  const conv = await db.conversation.findUnique({ where: { id: conversationId }, include: { customer: true } });
  if (!conv) return { ok: false, message: "Percakapan tidak ditemukan." };

  const draft = plan.draft;
  let noWa = conv.customer.phone;
  try {
    noWa = normalizePhone(draft.no_wa || conv.customer.phone);
  } catch {
    return { ok: false, message: "Nomor WA penerima tidak valid." };
  }

  const payload: OrderBaru = {
    external_id: "", // set below from the order fingerprint
    lead_id: "",
    metode_bayar: draft.metode_bayar || "cod",
    penerima: { nama: draft.nama, no_wa: noWa },
    alamat: {
      alamat: draft.alamat,
      ...(draft.kelurahan ? { kelurahan: draft.kelurahan } : {}),
      ...(draft.kecamatan ? { kecamatan: draft.kecamatan } : {}),
      kota: draft.kota,
      provinsi: draft.provinsi,
      ...(draft.kode_pos ? { kode_pos: draft.kode_pos } : {}),
    },
    items: draft.items,
    ongkir: plan.quote.cost,
    diskon: 0,
    subsidi_ongkir: plan.promo.shippingSubsidy,
    biaya_cod: plan.promo.codFee,
    subsidi_admin_cod: plan.promo.adminSubsidy,
    total: plan.promo.total,
    segmen: plan.segment,
    catatan: ["Dibuat otomatis oleh AI Agent.", draft.catatan].filter(Boolean).join(" "),
  };

  // The same cart, recipient and address on the same day always maps to one
  // external_id: a repeated "ya", a re-run of the AI or two concurrent replies
  // hit the unique key (and OMS is idempotent on it). A different cart, or the
  // same cart on another day, is a new order.
  payload.external_id = aiCheckoutExternalId(conversationId, orderFingerprint(payload));
  const existing = await db.omsCheckout.findUnique({ where: { externalId: payload.external_id } });
  if (existing && existing.status !== "failed") {
    return { ok: true, duplicate: true, checkoutId: existing.id, message: "Pesanan ini sudah dibuat sebelumnya." };
  }

  let row;
  if (existing) {
    // A failed attempt with the same id: retry it. OMS returns the existing
    // order if an earlier attempt did reach it.
    row = await db.omsCheckout.update({
      where: { id: existing.id },
      data: { status: "pending", lastError: null, payload: JSON.stringify(payload) },
    });
  } else {
    try {
      row = await db.omsCheckout.create({
        data: {
          externalId: payload.external_id,
          conversationId,
          payload: JSON.stringify(payload),
          createdByAi: true,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return { ok: true, duplicate: true, message: "Pesanan ini sedang dibuat." };
      }
      throw e;
    }
  }

  try {
    const checkout = await submitCheckout(row.id);
    await autoVerifyCheckout(row.id);
    return {
      ok: true,
      checkoutId: row.id,
      message: checkout
        ? `Pesanan dibuat: ${checkout.orders.map((o) => o.nomor).join(", ")}.`
        : "Pesanan sudah tercatat.",
    };
  } catch (e) {
    if (e instanceof OmsApiError && !isRetryableStatus(e.status)) {
      const message = friendlyOmsError(e);
      await db.omsCheckout.update({
        where: { id: row.id },
        data: { status: "failed", lastError: message },
      });
      await addSystemNote(conversationId, `Order otomatis AI ditolak: ${message}`);
      return { ok: false, noted: true, checkoutId: row.id, message };
    }
    await enqueueCheckoutSend(row.id);
    await processOutbox(10).catch((err) => console.error("[ai-order] outbox kick failed:", (err as Error).message));
    return {
      ok: true,
      queued: true,
      checkoutId: row.id,
      message: "OMS belum merespons; pesanan masuk antrian dan akan dicoba ulang otomatis.",
    };
  }
}

/** Confirmation must be explicit and follow a message where AI presented the total. */
export function isExplicitConfirmation(lastCustomer: string, lastAi: string) {
  const yes = /(^|\b)(ya|iya|yah|ok|oke|okey|boleh|gas|lanjut|setuju|betul|benar|siap|konfirmasi|pesan sekarang|buatkan|proses)\b/i;
  const asked = /(total|rincian|konfirmasi|setuju|buat pesanan|membuat pesanan|proses pesanan|balas ya)/i;
  return yes.test(lastCustomer) && asked.test(lastAi);
}

/** Convenience for the messaging layer. */
export async function planForConversation(conversationId: number, draft: AiOrderDraft, catalog: OmsCatalog) {
  const conv = await db.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    select: { customerId: true },
  });
  return planAutoOrder({ draft, catalog, segment: await customerSegment(conv.customerId) });
}
