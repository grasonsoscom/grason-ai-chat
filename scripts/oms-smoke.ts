// End-to-end smoke test against the OMS mock server and a throwaway SQLite DB.
// Run:
//   DATABASE_URL="file:./oms-test.db" npx prisma db push --skip-generate
//   node scripts/oms-mock-server.mjs            (separate terminal)
//   DATABASE_URL="file:./oms-test.db" OMS_BASE_URL="http://127.0.0.1:4010/api/v2" \
//     OMS_API_KEY="gok_test_secret" npx tsx scripts/oms-smoke.ts
import assert from "node:assert/strict";
import { db } from "../src/lib/db";
import { recordInbound } from "../src/lib/messaging";
import { getPrices } from "../src/lib/oms/client";
import { omsOnFirstResponse } from "../src/lib/oms/lead";
import { checkoutExternalId, isoUtc } from "../src/lib/oms/normalize";
import { submitCheckout, submitVerification } from "../src/lib/oms/orders";
import { processOutbox } from "../src/lib/oms/outbox";
import type { OrderBaru } from "../src/lib/oms/types";
import { orderQuote } from "../src/lib/promo-quote";

async function clean() {
  await db.message.deleteMany();
  await db.omsOrder.deleteMany();
  await db.omsCheckout.deleteMany();
  await db.omsOutbox.deleteMany();
  await db.omsWebhookEvent.deleteMany();
  await db.conversation.deleteMany();
  await db.customer.deleteMany();
}

async function main() {
  if (!process.env.OMS_BASE_URL || !process.env.OMS_API_KEY) {
    throw new Error("Set OMS_BASE_URL and OMS_API_KEY before running the smoke test.");
  }
  if (!(process.env.DATABASE_URL ?? "").includes("oms-test")) {
    throw new Error("Refusing to run: set DATABASE_URL=file:./oms-test.db (this script deletes test data).");
  }
  await clean();

  // 1. Inbound message -> lead created by the outbox.
  const inbound = await recordInbound({
    phone: "+6281234567890",
    name: "Ibu Sari",
    text: "Halo, saya mau pesan Bio Serea 2 dan Vivagoat",
  });
  assert.ok(inbound.conversationId, "conversation created");
  await processOutbox(20);

  const conv = await db.conversation.findUniqueOrThrow({ where: { id: inbound.conversationId } });
  assert.ok(conv.omsLeadId, "lead.id stored on the conversation");
  assert.equal(conv.omsLeadStatus, "baru");
  console.log("✓ lead created:", conv.omsLeadId, conv.omsLeadStatus);

  // 2. First response -> direspon + respon_pertama_at.
  await omsOnFirstResponse(conv.id);
  await processOutbox(20);
  const afterFirst = await db.conversation.findUniqueOrThrow({ where: { id: conv.id } });
  assert.ok(afterFirst.omsFirstResponseAt, "first response timestamp stored");
  assert.equal(afterFirst.omsLeadStatus, "direspon");
  console.log("✓ first response recorded");

  // 3. Mixed-entity checkout -> two orders + one buyer summary.
  const items = [
    { sku: "BSR-01", qty: 2 },
    { sku: "VVG-01", qty: 1 },
  ];
  const prices = await getPrices();
  const subtotal = items.reduce((sum, item) => {
    const price = prices.data.find((row) => row.sku === item.sku);
    if (!price) throw new Error(`Price for ${item.sku} not found`);
    return sum + price.harga_jual * item.qty;
  }, 0);
  const ongkir = 15000;
  const diskon = 0;
  const quote = orderQuote({ subtotal, ongkir, diskon, metode: "cod", segment: "nc", region: "jawa" });

  const payload: OrderBaru = {
    external_id: checkoutExternalId(conv.id),
    lead_id: "",
    metode_bayar: "cod",
    penerima: { nama: "Sari Wulandari", no_wa: "6281234567890" },
    alamat: {
      alamat: "Jl. Melati No. 12, RT 03/RW 05",
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
    segmen: "nc",
  };
  const checkoutRow = await db.omsCheckout.create({
    data: { externalId: payload.external_id, conversationId: conv.id, payload: JSON.stringify(payload) },
  });
  const checkout = await submitCheckout(checkoutRow.id);
  assert.ok(checkout, "checkout response");
  assert.equal(checkout.orders.length, 2, "two orders for mixed SSR/FHI items");

  const orders = await db.omsOrder.findMany({ where: { conversationId: conv.id }, orderBy: { id: "asc" } });
  assert.equal(orders.length, 2, "two local order mirrors");
  console.log("✓ checkout created:", orders.map((o) => `${o.nomor}/${o.entitas}/${o.total}`).join(", "));

  const messages = await db.message.findMany({ where: { conversationId: conv.id }, orderBy: { id: "asc" } });
  const summary = messages.find((m) => m.text.includes(checkout.orders[0].nomor));
  assert.ok(summary, "buyer summary sent");
  for (const order of checkout.orders) assert.ok(summary.text.includes(order.nomor), "summary lists every order number");
  assert.match(summary.text, /dua paket/i);
  console.log("✓ buyer summary lists both order numbers and COD");

  // 4. Verification with the exact OMS COD value.
  const first = orders[0];
  const verified = await submitVerification(first.id, {
    dikonfirmasi_at: isoUtc(),
    nilai_cod_dikonfirmasi: first.nilaiCod,
    catatan: "Smoke test",
  });
  assert.equal(verified.status, "terverifikasi");
  const localVerified = await db.omsOrder.findUniqueOrThrow({ where: { id: first.id } });
  assert.equal(localVerified.status, "terverifikasi");
  console.log("✓ order verified:", first.nomor);

  await db.$disconnect();
  console.log("\nOMS smoke test passed.");
}

main().catch(async (e) => {
  console.error("OMS smoke test failed:", e);
  await db.$disconnect();
  process.exit(1);
});
