// Sends a signed order.status_changed event to the running app and verifies the
// status update + customer follow-up. Run after scripts/oms-smoke.ts.
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { db } from "../src/lib/db";

const appUrl = process.env.APP_URL ?? "http://127.0.0.1:3002";
const secret = process.env.OMS_WEBHOOK_SECRET ?? "";
if (!secret) throw new Error("Set OMS_WEBHOOK_SECRET.");

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes("oms-test")) {
    throw new Error("Refusing to run: set DATABASE_URL=file:./oms-test.db (this script mutates test orders).");
  }
  const order = await db.omsOrder.findFirst({ where: { status: "terverifikasi" }, orderBy: { id: "asc" } });
  if (!order) throw new Error("No order in the test DB. Run scripts/oms-smoke.ts first.");

  const event = {
    event_id: randomUUID(),
    jenis: "order.status_changed",
    terjadi_at: new Date().toISOString(),
    data: {
      order_id: order.omsOrderId,
      nomor: order.nomor,
      order_group_id: order.orderGroupId ?? "group",
      checkout_external_id: null,
      lead_id: null,
      lead_external_id: null,
      status_sebelum: order.status,
      status: "dikirim",
      alasan: "resi_terbit",
      kurir: "JNE",
      resi: "JNE0123456789",
      percobaan_antar: 1,
    },
  };
  const raw = JSON.stringify(event);
  const ts = Math.floor(Date.now() / 1000);
  const signature = `sha256=${createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex")}`;
  const headers = {
    "content-type": "application/json",
    "x-oms-signature": signature,
    "x-oms-timestamp": String(ts),
    "idempotency-key": event.event_id,
  };

  const res = await fetch(`${appUrl}/api/webhooks/oms`, { method: "POST", headers, body: raw });
  assert.equal(res.status, 200, `webhook responded ${res.status}`);
  console.log("✓ webhook accepted");

  let updated = null;
  for (let i = 0; i < 50; i++) {
    const row = await db.omsOrder.findUnique({ where: { id: order.id } });
    if (row?.status === "dikirim") {
      updated = row;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(updated, "order status updated to dikirim");

  const message = await db.message.findFirst({
    where: { conversationId: order.conversationId, text: { contains: "JNE0123456789" } },
    orderBy: { id: "desc" },
  });
  assert.ok(message, "customer follow-up with resi sent");
  console.log("✓ order updated and customer follow-up sent:", order.nomor);

  const duplicate = await fetch(`${appUrl}/api/webhooks/oms`, { method: "POST", headers, body: raw });
  assert.equal(duplicate.status, 200, `duplicate webhook responded ${duplicate.status}`);
  console.log("✓ duplicate event acknowledged");

  // Invalid signature must be rejected.
  const bad = await fetch(`${appUrl}/api/webhooks/oms`, {
    method: "POST",
    headers: { ...headers, "x-oms-signature": "sha256=deadbeef" },
    body: raw,
  });
  assert.equal(bad.status, 400, `invalid signature responded ${bad.status}`);
  console.log("✓ invalid signature rejected");

  await db.$disconnect();
  console.log("\nOMS webhook smoke test passed.");
}

main().catch(async (e) => {
  console.error("OMS webhook smoke test failed:", e);
  await db.$disconnect();
  process.exit(1);
});
