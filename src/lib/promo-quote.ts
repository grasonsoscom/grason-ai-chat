// Pure COD/shipping subsidy rules. Safe to import from client components:
// this module must not import Prisma or any server-only code.
//
// Source: "Promo Subsidi Ongkir Retail" and "Promo Subsidi Admin COD All Customer".

export type Segment = "nc" | "ro" | "reseller";
export type Region = "jawa" | "luar";

export const SEGMENT_LABEL: Record<Segment, string> = {
  nc: "New Customer",
  ro: "Repeat Order",
  reseller: "Reseller",
};

const COD_FEE_RATE = 0.03;
const COD_ADMIN_SUBSIDY = 5_000;
/** Minimum order, counted from product price + shipping (before subsidy). */
const MIN_ORDER: Record<Segment, number> = { nc: 120_000, ro: 120_000, reseller: 200_000 };

/** Subsidi ongkir. The scheme has no shipping subsidy for resellers. */
function shippingSubsidy(segment: Segment, region: Region, ongkir: number) {
  if (segment === "nc") {
    if (region === "jawa") return Math.min(ongkir, 25_000);
    return ongkir >= 50_000 ? 25_000 : Math.round(ongkir * 0.5);
  }
  if (segment === "ro") return Math.min(ongkir, region === "jawa" ? 30_000 : 50_000);
  return 0;
}

export type CodQuote = {
  subtotal: number;
  eligible: boolean;
  shippingSubsidy: number;
  codFee: number;
  adminSubsidy: number;
  codFeeNet: number;
  total: number;
};

/** Single-package quote used by the AI/shipping prompt. */
export function codQuote(price: number, ongkir: number, segment: Segment, region: Region): CodQuote {
  const subtotal = price + ongkir;
  const eligible = subtotal >= MIN_ORDER[segment];
  const subsidy = eligible ? shippingSubsidy(segment, region, ongkir) : 0;
  const codFee = Math.round(subtotal * COD_FEE_RATE);
  const adminSubsidy = eligible ? Math.min(COD_ADMIN_SUBSIDY, codFee) : 0;
  const codFeeNet = codFee - adminSubsidy;
  return {
    subtotal,
    eligible,
    shippingSubsidy: subsidy,
    codFee,
    adminSubsidy,
    codFeeNet,
    total: subtotal - subsidy + codFeeNet,
  };
}

export type OrderQuoteInput = {
  /** Sum of OMS `harga_jual` × qty for the whole checkout. */
  subtotal: number;
  ongkir: number;
  diskon: number;
  metode: "cod" | "transfer";
  segment: Segment;
  region: Region;
};

export type OrderQuote = {
  subtotal: number;
  eligible: boolean;
  shippingSubsidy: number;
  codFee: number;
  adminSubsidy: number;
  total: number;
};

/**
 * Cart-level quote for the OMS v2 order payload.
 * The OMS validates total = subtotal − diskon + ongkir − subsidi_ongkir
 * + biaya_cod − subsidi_admin_cod; all values are integer rupiah.
 */
export function orderQuote(input: OrderQuoteInput): OrderQuote {
  const { subtotal, ongkir, diskon, metode, segment, region } = input;
  const base = subtotal + ongkir;
  const eligible = base >= MIN_ORDER[segment];

  if (metode === "transfer") {
    return {
      subtotal,
      eligible,
      shippingSubsidy: 0,
      codFee: 0,
      adminSubsidy: 0,
      total: subtotal - diskon + ongkir,
    };
  }

  const shipping = eligible ? shippingSubsidy(segment, region, ongkir) : 0;
  const codFee = Math.round(base * COD_FEE_RATE);
  const adminSubsidy = eligible ? Math.min(COD_ADMIN_SUBSIDY, codFee) : 0;
  return {
    subtotal,
    eligible,
    shippingSubsidy: shipping,
    codFee,
    adminSubsidy,
    total: subtotal - diskon + ongkir - shipping + codFee - adminSubsidy,
  };
}

export function minOrder(segment: Segment) {
  return MIN_ORDER[segment];
}

const JAWA = /\b(jawa barat|jawa tengah|jawa timur|jabar|jateng|jatim|dki|jakarta|banten|yogyakarta|jogja|jogjakarta|diy)\b/i;
const LUAR = /\b(aceh|sumatera|sumatra|sumut|sumbar|sumsel|riau|kepri|jambi|bengkulu|lampung|bangka|belitung|kalimantan|kalbar|kalteng|kalsel|kaltim|kaltara|sulawesi|sulut|sulteng|sulsel|sultra|sulbar|gorontalo|maluku|papua|bali|nusa tenggara|ntb|ntt)\b/i;

/** Island group from a province named in the text; null when none is named. */
export function regionFromText(text: string): Region | null {
  const t = text.toLowerCase();
  const jawa = t.search(JAWA);
  const luar = t.search(LUAR);
  if (jawa < 0 && luar < 0) return null;
  if (jawa < 0) return "luar";
  if (luar < 0) return "jawa";
  return jawa > luar ? "jawa" : "luar";
}
