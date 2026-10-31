// End-to-end AI-order smoke test with the OMS mock + scripted LLM mock.
// Run:
//   DATABASE_URL="file:./ai-order-test.db" npx prisma db push --skip-generate
//   node scripts/oms-mock-server.mjs          (one terminal)
//   node scripts/ai-mock-server.mjs           (one terminal)
//   DATABASE_URL="file:./ai-order-test.db" OMS_BASE_URL="http://127.0.0.1:4010/api/v2" \
//     OMS_API_KEY="gok_test_secret" AI_PROVIDER="openai" \
//     OPENAI_BASE_URL="http://127.0.0.1:4020/v1" OPENAI_MODEL="mock" OPENAI_API_KEY="mock" \
//     npx tsx --env-file=.env scripts/ai-order-smoke.ts
import assert from "node:assert/strict";
import { db } from "../src/lib/db";
import { recordInbound } from "../src/lib/messaging";
import { processOutbox } from "../src/lib/oms/outbox";

async function clean() {
  await db.message.deleteMany();
  await db.omsOrder.deleteMany();
  await db.omsCheckout.deleteMany();
  await db.omsOutbox.deleteMany();
  await db.omsWebhookEvent.deleteMany();
  await db.conversation.deleteMany();
  await db.customer.deleteMany();
  await db.aiAgent.deleteMany();
  await db.device.deleteMany();
  await db.shippingRate.deleteMany();
}

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes("ai-order-test")) {
    throw new Error("Refusing to run: set DATABASE_URL=file:./ai-order-test.db (this script deletes test data).");
  }
  if (!process.env.OMS_BASE_URL || !process.env.OMS_API_KEY) {
    throw new Error("Set OMS_BASE_URL and OMS_API_KEY before running.");
  }
  if (!(process.env.OPENAI_BASE_URL ?? "").includes("4020")) {
    throw new Error("Point OPENAI_BASE_URL to the mock LLM on port 4020.");
  }
  await clean();

  const device = await db.device.create({ data: { label: "Simulasi", phone: "+6280000000000" } });
  await db.aiAgent.create({
    data: {
      name: "Agen Simulasi",
      active: true,
      autoOrder: true,
      autoVerifyOrders: true,
      devices: { connect: { id: device.id } },
    },
  });
  await db.shippingRate.create({
    data: { service: "REG", warehouse: "Bandung", city: "Bandung", district: "Sukajadi", price: 15000 },
  });

  const phone = "+6281234567890";
  const turn1 = await recordInbound({
    phone,
    name: "Budi",
    text: "Halo, saya mau pesan Bio Serea 1 botol",
    deviceId: device.id,
  });
  assert.equal(turn1.ai, "replied");
  const conv = await db.conversation.findUniqueOrThrow({ where: { customerId: (await db.customer.findUniqueOrThrow({ where: { phone } })).id } });
  assert.equal(await db.omsCheckout.count({ where: { conversationId: conv.id } }), 0, "no order before address");
  console.log("✓ turn 1: AI collected the product and asked for the address");

  const turn2 = await recordInbound({
    phone,
    text: "Nama saya Budi, alamat Jl. Melati No. 2, kecamatan Sukajadi, kota Bandung, provinsi Jawa Barat, kode pos 40162, COD",
    deviceId: device.id,
  });
  assert.equal(turn2.ai, "replied");
  assert.equal(await db.omsCheckout.count({ where: { conversationId: conv.id } }), 0, "no order before confirmation");
  const asked = await db.message.findFirstOrThrow({ where: { conversationId: conv.id, direction: "out", sender: "ai" }, orderBy: { id: "desc" } });
  assert.match(asked.text, /Balas YA/i);
  console.log("✓ turn 2: AI quoted shipping and asked for confirmation");

  const turn3 = await recordInbound({ phone, text: "ya", deviceId: device.id });
  assert.equal(turn3.ai, "order");
  await processOutbox(20);

  const checkout = await db.omsCheckout.findFirstOrThrow({
    where: { conversationId: conv.id },
    include: { orders: true },
  });
  assert.equal(checkout.createdByAi, true, "checkout marked as AI-created");
  assert.equal(checkout.status, "created");
  assert.equal(checkout.orders.length, 1);
  const order = checkout.orders[0];
  assert.equal(order.status, "terverifikasi", "auto-verified by the agent setting");
  const payload = JSON.parse(checkout.payload) as { total: number; ongkir: number; biaya_cod: number; subsidi_ongkir: number };
  assert.equal(payload.ongkir, 15000);
  assert.equal(payload.biaya_cod, 3300);
  assert.equal(payload.subsidi_ongkir, 0);
  assert.equal(payload.total, 113300);
  console.log("✓ turn 3: order created, totals match, and it was auto-verified:", order.nomor);

  const summary = await db.message.findFirst({
    where: { conversationId: conv.id, text: { contains: order.nomor } },
  });
  assert.ok(summary, "buyer summary contains the order number");
  assert.match(summary.text, /Pesanan kamu sudah dibuat/);
  console.log("✓ buyer summary sent with the order number");

  await db.$disconnect();
  console.log("\nAI order smoke test passed.");
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
