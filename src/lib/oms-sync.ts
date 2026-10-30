// Keeps conversations in sync with OMS GRASON leads/orders. Every function here is a
// no-op when OMS_BASE_URL / OMS_API_KEY are not set. Lead updates never throw, so a
// down OMS never blocks chat; order functions throw so the caller can tell the staff.
import { db } from "./db";
import { formatIDR } from "./format";
import { customerSegment, type CodQuote } from "./promo";
import {
  conversationIdFromLead, leadExternalId, oms, omsConfigured, orderAmounts, OmsError,
  type Address, type Checkout, type LeadUpdate, type OrderStatus, type OrderStatusEvent, type PaymentMethod,
} from "./oms";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  baru: "Baru", terverifikasi: "Terverifikasi", di_gudang: "Di gudang", dikirim: "Dikirim",
  terkirim: "Terkirim (diterima pembeli)", batal: "Batal", rts: "RTS (dikembalikan)",
};

async function note(conversationId: number, text: string) {
  await db.message.create({ data: { conversationId, direction: "out", sender: "system", text, status: "sent" } });
}

function reason(e: unknown) {
  return (e as Error).message || "galat tidak diketahui";
}

/** Called by recordInbound for a conversation that did not exist before. */
export async function startOmsLead(conversationId: number) {
  if (!omsConfigured()) return;
  await db.conversation.update({ where: { id: conversationId }, data: { omsLeadPending: true } });
  await ensureOmsLead(conversationId);
}

/**
 * Creates the OMS lead for a pending conversation and returns its OMS id. A failed
 * attempt stays pending and is retried on the next sync call; external_id makes that safe.
 */
export async function ensureOmsLead(conversationId: number): Promise<string | null> {
  if (!omsConfigured()) return null;
  const conv = await db.conversation.findUnique({ where: { id: conversationId }, include: { customer: true } });
  if (!conv) return null;
  if (conv.omsLeadId) return conv.omsLeadId;
  if (!conv.omsLeadPending) return null; // conversation started before the integration
  const first = await db.message.findFirst({ where: { conversationId, direction: "in" }, orderBy: { createdAt: "asc" } });
  try {
    const lead = await oms.createLead({
      external_id: leadExternalId(conversationId),
      no_wa: conv.customer.phone,
      ...(conv.customer.name !== conv.customer.phone ? { nama: conv.customer.name.slice(0, 100) } : {}),
      masuk_at: (first?.createdAt ?? new Date()).toISOString(),
      segmen: await customerSegment(conv.customerId),
      // TODO(product): kanal/campaign_id/ad_id from click-to-WhatsApp referral, sku_ditanya.
    });
    await db.conversation.update({ where: { id: conversationId }, data: { omsLeadId: lead.id, omsLeadPending: false } });
    return lead.id;
  } catch (e) {
    console.error(`[oms] lead for conversation ${conversationId} failed:`, reason(e));
    await note(conversationId, `Lead belum tercatat di OMS: ${reason(e)} Dicoba lagi saat pesan berikutnya.`);
    return null;
  }
}

async function patchLead(conversationId: number, patch: LeadUpdate, label: string) {
  const leadId = await ensureOmsLead(conversationId);
  if (!leadId) return false;
  try {
    await oms.updateLead(leadId, patch);
    return true;
  } catch (e) {
    console.error(`[oms] ${label} for conversation ${conversationId} failed:`, reason(e));
    await note(conversationId, `OMS: ${label} gagal dicatat: ${reason(e)}`);
    return false;
  }
}

/** First AI/staff reply: respon_pertama_at + status direspon. Sent once per conversation. */
export async function omsFirstResponse(conversationId: number, at: Date) {
  if (!omsConfigured()) return;
  const conv = await db.conversation.findUnique({ where: { id: conversationId } });
  if (!conv || conv.omsRespondedAt) return;
  if (await patchLead(conversationId, { respon_pertama_at: at.toISOString(), status: "direspon" }, "respon pertama")) {
    await db.conversation.update({ where: { id: conversationId }, data: { omsRespondedAt: at } });
  }
}

/** Hand the lead to a human CS in OMS. OMS cannot undo a handover, so it is sent once. */
export async function omsHandover(conversationId: number, alasan: string) {
  if (!omsConfigured()) return;
  const conv = await db.conversation.findUnique({ where: { id: conversationId } });
  if (!conv || conv.omsHandoverAt) return;
  const at = new Date();
  if (await patchLead(conversationId, { handover: { alasan: alasan.slice(0, 500), terjadi_at: at.toISOString() } }, "handover")) {
    await db.conversation.update({ where: { id: conversationId }, data: { omsHandoverAt: at } });
  }
}

export async function omsFollowUp(conversationId: number) {
  if (!omsConfigured()) return;
  await patchLead(conversationId, { status: "follow_up" }, "status follow up");
}

export type CheckoutInput = {
  /** Stable checkout id in AI Chat, sent as external_id (e.g. "checkout-<id>"). */
  externalId: string;
  method: PaymentMethod;
  recipient: { name: string; phone: string };
  address: Address;
  items: { sku: string; qty: number }[];
  /** Product total the customer pays, before shipping (must match OMS harga_jual × qty). */
  price: number;
  ongkir: number;
  /** codQuote(price, ongkir, segment, region); required for COD. */
  quote?: CodQuote;
  notes?: string;
};

async function saveCheckout(conversationId: number, checkout: Checkout) {
  const saved = await db.omsCheckout.upsert({
    where: { externalId: checkout.external_id },
    update: { orderGroupId: checkout.order_group_id },
    create: { externalId: checkout.external_id, conversationId, orderGroupId: checkout.order_group_id },
  });
  for (const o of checkout.orders) {
    const data = { nomor: o.nomor, entitas: o.entitas, status: o.status, nilaiCod: o.nilai_cod, perluVerifikasiManusia: Boolean(o.perlu_verifikasi_manusia) };
    await db.omsOrder.upsert({ where: { id: o.id }, update: data, create: { id: o.id, checkoutId: saved.id, ...data } });
  }
}

/**
 * POST /orders for a conversation's checkout. Throws OmsError (e.g. total_tidak_cocok,
 * stok_tidak_cukup) with an Indonesian message; nothing is sent to the customer.
 */
export async function createOmsCheckout(conversationId: number, input: CheckoutInput) {
  if (!omsConfigured()) throw new Error("Integrasi OMS belum dikonfigurasi. Isi OMS_BASE_URL dan OMS_API_KEY.");
  const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversationId } });
  // An order needs a lead, also for conversations from before the integration.
  if (!conv.omsLeadId && !conv.omsLeadPending) await db.conversation.update({ where: { id: conversationId }, data: { omsLeadPending: true } });
  const leadId = await ensureOmsLead(conversationId);
  if (!leadId) throw new Error("Lead percakapan ini belum tercatat di OMS.");
  const checkout = await oms.createOrder({
    external_id: input.externalId,
    lead_id: leadId,
    metode_bayar: input.method,
    penerima: { nama: input.recipient.name.slice(0, 100), no_wa: input.recipient.phone },
    alamat: input.address,
    items: input.items,
    ...orderAmounts(input.method, input.price, input.ongkir, input.quote),
    segmen: await customerSegment(conv.customerId),
    ...(input.notes ? { catatan: input.notes.slice(0, 1000) } : {}),
  });
  await saveCheckout(conversationId, checkout);
  const lines = checkout.orders.map((o) =>
    `${o.nomor} (${o.entitas}, ${o.metode_bayar.toUpperCase()} ${formatIDR(o.nilai_cod)})${o.perlu_verifikasi_manusia ? ": perlu verifikasi CS manusia (riwayat RTS)" : ""}`);
  await note(conversationId, `Order dibuat di OMS: ${lines.join("; ")}.`);
  return checkout;
}

/**
 * Customer confirmed address, COD amount and willingness to pay: verifies every order of
 * the checkout. Orders flagged perlu_verifikasi_manusia are refused before calling OMS.
 */
export async function verifyOmsCheckout(externalId: string, confirmedAt: Date, notes?: string) {
  const checkout = await db.omsCheckout.findUniqueOrThrow({ where: { externalId }, include: { orders: true } });
  const human = checkout.orders.filter((o) => o.perluVerifikasiManusia);
  if (human.length) {
    throw new OmsError(422, "perlu_verifikasi_manusia", `Order ${human.map((o) => o.nomor).join(", ")} harus diverifikasi CS manusia (riwayat RTS).`);
  }
  for (const o of checkout.orders) {
    if (o.status !== "baru") continue;
    const order = await oms.verifyOrder(o.id, {
      dikonfirmasi_at: confirmedAt.toISOString(),
      nilai_cod_dikonfirmasi: o.nilaiCod,
      ...(notes ? { catatan: notes.slice(0, 1000) } : {}),
    });
    await db.omsOrder.update({ where: { id: o.id }, data: { status: order.status } });
  }
  await note(checkout.conversationId, `Order ${checkout.orders.map((o) => o.nomor).join(", ")} terverifikasi di OMS.`);
}

export type PriceMismatch = { productId: number; name: string; sku: string; ours: number; oms: number | null };

/** Variants with a SKU whose price (promo price if set) differs from OMS harga_jual, or whose SKU OMS does not know. */
export async function omsPriceMismatches(): Promise<PriceMismatch[]> {
  const [prices, variants] = await Promise.all([
    oms.prices(),
    db.productVariant.findMany({ where: { sku: { not: "" } }, include: { product: true }, orderBy: { productId: "asc" } }),
  ]);
  const bySku = new Map(prices.map((p) => [p.sku, p.harga_jual]));
  return variants.flatMap((v) => {
    const ours = v.salePrice ?? v.price;
    const omsPrice = bySku.get(v.sku.trim()) ?? null;
    return omsPrice === ours ? [] : [{ productId: v.productId, name: `${v.product.name} ${v.name}`, sku: v.sku, ours, oms: omsPrice }];
  });
}

/** Refreshes stored order status from GET /orders/{id}. */
export async function refreshOmsOrder(orderId: string) {
  const order = await oms.getOrder(orderId);
  await db.omsOrder.update({ where: { id: orderId }, data: { status: order.status } });
  return order;
}

function eventNote(d: OrderStatusEvent["data"], stale: boolean) {
  const parts = [`Status order ${d.nomor} di OMS: ${STATUS_LABEL[d.status] ?? d.status}`];
  if (d.alasan) parts.push(`alasan: ${d.alasan.replace(/_/g, " ")}`);
  if (d.kurir || d.resi) parts.push(`resi: ${[d.kurir, d.resi].filter(Boolean).join(" ")}`);
  if (d.percobaan_antar) parts.push(`percobaan antar ke-${d.percobaan_antar}`);
  return parts.join(", ") + (stale ? " (event lebih lama dari status tersimpan; status tidak diubah)." : ".");
}

/**
 * Applies one order.status_changed event. Returns "duplicate" for an event_id seen before.
 * Events can arrive out of order: status only moves to an event with a later terjadi_at.
 * Only a system note is added; no WhatsApp message goes to the customer.
 */
export async function handleOmsEvent(event: OrderStatusEvent): Promise<"ok" | "duplicate"> {
  const d = event.data;
  const terjadiAt = new Date(event.terjadi_at);
  try {
    await db.omsEvent.create({ data: { eventId: event.event_id, jenis: event.jenis, orderId: d.order_id, status: d.status, terjadiAt } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return "duplicate";
    throw e;
  }
  const order = await db.omsOrder.findUnique({ where: { id: d.order_id }, include: { checkout: true } });
  const stale = Boolean(order?.statusAt && order.statusAt > terjadiAt);
  if (order && !stale) {
    await db.omsOrder.update({ where: { id: order.id }, data: { status: d.status, statusAt: terjadiAt } });
  }
  let conversationId = order?.checkout.conversationId ?? conversationIdFromLead(d.lead_external_id);
  if (!conversationId && d.lead_id) conversationId = (await db.conversation.findUnique({ where: { omsLeadId: d.lead_id } }))?.id ?? null;
  if (conversationId && (await db.conversation.findUnique({ where: { id: conversationId } }))) {
    await note(conversationId, eventNote(d, stale));
  } else {
    console.warn(`[oms] event ${event.event_id}: no conversation for order ${d.nomor}`);
  }
  return "ok";
}
