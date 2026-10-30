// Shipping subsidy and COD admin subsidy scheme (COD orders only).
// Source: "Promo Subsidi Ongkir Retail" and "Promo Subsidi Admin COD All Customer".
import { db } from "./db";

export type Segment = "nc" | "ro" | "reseller";
export type Region = "jawa" | "luar";

export const SEGMENT_LABEL: Record<Segment, string> = { nc: "New Customer", ro: "Repeat Order", reseller: "Reseller" };

const COD_FEE_RATE = 0.03;
const COD_ADMIN_SUBSIDY = 5_000;
/** Minimum order, counted from product price + shipping (before subsidy). */
const MIN_ORDER: Record<Segment, number> = { nc: 120_000, ro: 120_000, reseller: 200_000 };
// A chat older than this means the customer has talked to us before.
const REPEAT_AFTER_DAYS = 7;

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
  subtotal: number; eligible: boolean; shippingSubsidy: number;
  codFee: number; adminSubsidy: number; codFeeNet: number; total: number;
};

export function codQuote(price: number, ongkir: number, segment: Segment, region: Region): CodQuote {
  const subtotal = price + ongkir;
  const eligible = subtotal >= MIN_ORDER[segment];
  const subsidy = eligible ? shippingSubsidy(segment, region, ongkir) : 0;
  const codFee = Math.round(subtotal * COD_FEE_RATE);
  const adminSubsidy = eligible ? Math.min(COD_ADMIN_SUBSIDY, codFee) : 0;
  const codFeeNet = codFee - adminSubsidy;
  return { subtotal, eligible, shippingSubsidy: subsidy, codFee, adminSubsidy, codFeeNet, total: subtotal - subsidy + codFeeNet };
}

export function minOrder(segment: Segment) {
  return MIN_ORDER[segment];
}

/** Staff-set type wins; otherwise RO when the customer chatted more than a week ago. */
export async function customerSegment(customerId: number): Promise<Segment> {
  const c = await db.customer.findUnique({ where: { id: customerId }, include: { conversation: true } });
  if (!c) return "nc";
  if (c.segment === "nc" || c.segment === "ro" || c.segment === "reseller") return c.segment;
  if (!c.conversation) return "nc";
  const cutoff = new Date(Date.now() - REPEAT_AFTER_DAYS * 86_400_000);
  const old = await db.message.findFirst({ where: { conversationId: c.conversation.id, direction: "in", createdAt: { lt: cutoff } } });
  return old ? "ro" : "nc";
}

const JAWA = /\b(jawa barat|jawa tengah|jawa timur|jabar|jateng|jatim|dki|jakarta|banten|yogyakarta|jogja|jogjakarta|diy)\b/i;
const LUAR = /\b(aceh|sumatera|sumatra|sumut|sumbar|sumsel|riau|kepri|jambi|bengkulu|lampung|bangka|belitung|kalimantan|kalbar|kalteng|kalsel|kaltim|kaltara|sulawesi|sulut|sulteng|sulsel|sultra|sulbar|gorontalo|maluku|papua|bali|nusa tenggara|ntb|ntt)\b/i;

/** Island group from a province named in the text; null when none is named. */
export function regionFromText(text: string): Region | null {
  const t = text.toLowerCase();
  const jawa = t.search(JAWA), luar = t.search(LUAR);
  if (jawa < 0 && luar < 0) return null;
  if (jawa < 0) return "luar";
  if (luar < 0) return "jawa";
  return jawa > luar ? "jawa" : "luar"; // the later mention is usually the province line
}
