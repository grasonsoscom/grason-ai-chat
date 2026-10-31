// Imports the deployed chat code to test a real OMS v2 checkout.
// Run on the VPS from /opt/grason-ai-chat with its .env loaded.
import { db } from "../src/lib/db";
import { getPrices } from "../src/lib/oms/client";
import { checkoutExternalId } from "../src/lib/oms/normalize";
import { submitCheckout } from "../src/lib/oms/orders";
import type { OrderBaru } from "../src/lib/oms/types";
import { orderQuote } from "../src/lib/promo-quote";

const PHONE = "+6281299990002";

async function main() {
  const conv = await db.conversation.findFirst({
    where: { customer: { phone: PHONE } },
    orderBy: { id: "desc" },
    include: { customer: true },
  });
  if (!conv) throw new Error(`Conversation not found for ${PHONE}; run the inbound webhook first.`);
  console.log("conversation", conv.id, "lead", conv.omsLeadId, "customer", conv.customer.name);

  const items = [{ sku: "BSR-01", qty: 2 }];
  const prices = await getPrices();
  const subtotal = items.reduce((sum, item) => {
    const price = prices.data.find((row) => row.sku === item.sku);
    if (!price) throw new Error(`Price not found: ${item.sku}`);
    return sum + price.harga_jual * item.qty;
  }, 0);

  const ongkir = 15000;
  const diskon = 0;
  const segmen = "nc" as const;
  const quote = orderQuote({
    subtotal,
    ongkir,
    diskon,
    metode: "cod",
    segment: segmen,
    region: "jawa",
  });
  console.log("subtotal", subtotal, "quote", quote);

  const payload: OrderBaru = {
    external_id: checkoutExternalId(conv.id),
    lead_id: "",
    metode_bayar: "cod",
    penerima: { nama: conv.customer.name, no_wa: "6281299990002" },
    alamat: {
      alamat: "Jl. V2 Test No. 1",
      kelurahan: "Sukajadi",
      kecamatan: "Sukajadi",
      kota: "Bandung",
      provinsi: "Jawa Barat",
      kode_pos: "40162",
    },
    items,
    ongkir,
    diskon,
    subsidi_ongkir: quote.shippingSubsidy,
    biaya_cod: quote.codFee,
    subsidi_admin_cod: quote.adminSubsidy,
    total: quote.total,
    segmen,
    catatan: "Uji v2 staging",
  };

  const row = await db.omsCheckout.create({
    data: {
      externalId: payload.external_id,
      conversationId: conv.id,
      payload: JSON.stringify(payload),
    },
  });

  const checkout = await submitCheckout(row.id);
  console.log(
    "checkout",
    JSON.stringify(
      checkout?.orders.map((order) => ({
        id: order.id,
        nomor: order.nomor,
        status: order.status,
        total: order.total,
        nilai_cod: order.nilai_cod,
        subsidi_ongkir: order.subsidi_ongkir,
        biaya_cod: order.biaya_cod,
        subsidi_admin_cod: order.subsidi_admin_cod,
        segmen: order.segmen,
      })),
      null,
      2,
    ),
  );

  const local = await db.omsOrder.findFirst({
    where: { conversationId: conv.id },
    orderBy: { id: "desc" },
  });
  console.log(
    "local",
    local && {
      nomor: local.nomor,
      status: local.status,
      total: local.total,
      nilaiCod: local.nilaiCod,
      subsidiOngkir: local.subsidiOngkir,
      biayaCod: local.biayaCod,
      subsidiAdminCod: local.subsidiAdminCod,
      segmen: local.segmen,
    },
  );

  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
