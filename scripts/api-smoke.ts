// End-to-end smoke test for /api/v1 against a throwaway SQLite DB.
// Run:
//   DATABASE_URL="file:./api-test.db" npx prisma db push --skip-generate
//   DATABASE_URL="file:./api-test.db" npx tsx scripts/api-smoke.ts
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { db } from "../src/lib/db";
import { generateApiToken } from "../src/lib/api/tokens";
import { verifyWebhookSignature } from "../src/lib/webhooks/signature";
import { sendTestWebhook } from "../src/lib/webhooks/dispatch";

import { GET as meGet } from "../src/app/api/v1/me/route";
import { GET as contactsGet, POST as contactsPost } from "../src/app/api/v1/contacts/route";
import { PATCH as contactPatch, DELETE as contactDelete } from "../src/app/api/v1/contacts/[id]/route";
import { GET as segmentsGet, POST as segmentsPost } from "../src/app/api/v1/segments/route";
import { GET as segmentContactsGet } from "../src/app/api/v1/segments/[id]/contacts/route";
import { GET as conversationsGet } from "../src/app/api/v1/conversations/route";
import { GET as messagesGet } from "../src/app/api/v1/conversations/[id]/messages/route";
import { POST as sendMessagePost } from "../src/app/api/v1/messages/send/route";
import { GET as campaignsGet, POST as campaignsPost } from "../src/app/api/v1/campaigns/route";
import { POST as launchPost } from "../src/app/api/v1/campaigns/[id]/launch/route";
import { GET as recipientsGet } from "../src/app/api/v1/campaigns/[id]/recipients/route";
import { GET as webhooksGet, POST as webhooksPost } from "../src/app/api/v1/webhooks/route";
import { GET as walletGet } from "../src/app/api/v1/wallet/route";
import { GET as transactionsGet } from "../src/app/api/v1/wallet/transactions/route";
import { GET as analyticsGet } from "../src/app/api/v1/analytics/summary/route";
import { GET as openapiGet } from "../src/app/api/v1/openapi.json/route";

type Json = Record<string, unknown>;

async function clean() {
  await db.calendarEvent.deleteMany();
  await db.broadcastRecipient.deleteMany();
  await db.broadcast.deleteMany();
  await db.message.deleteMany();
  await db.conversation.deleteMany();
  await db.customer.deleteMany();
  await db.audience.deleteMany();
  await db.label.deleteMany();
  await db.messageTemplate.deleteMany();
  await db.deviceEvent.deleteMany();
  await db.device.deleteMany();
  await db.apiToken.deleteMany();
  await db.webhookEndpoint.deleteMany();
  await db.coinTransaction.deleteMany();
  await db.account.deleteMany();
  await db.user.deleteMany();
  await db.role.deleteMany();
  await db.group.deleteMany();
}

async function call(
  handler: (req: Request, ctx: any) => Promise<Response>,
  token: string,
  path: string,
  init: { method?: string; body?: unknown; params?: Record<string, string> } = {},
) {
  const req = new Request(`http://localhost:3000${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const ctx = init.params ? { params: Promise.resolve(init.params) } : undefined;
  const res = await handler(req, ctx);
  const text = await res.text();
  const json = text ? (JSON.parse(text) as Json) : {};
  return { res, json };
}

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes("api-test")) {
    throw new Error("Refusing to run: set DATABASE_URL=file:./api-test.db (this script deletes test data).");
  }
  await clean();

  const role = await db.role.create({ data: { name: "Admin", permissions: "all" } });
  const user = await db.user.create({
    data: { name: "API Tester", email: "api@test.local", passwordHash: "x", roleId: role.id },
  });
  await db.account.create({ data: { id: 1, name: "API Test", coins: 1000 } });
  const device = await db.device.create({
    data: { label: "Test Device", phone: "+6280000000000", apiType: "Cloud API" },
  });
  const template = await db.messageTemplate.create({
    data: { deviceId: device.id, name: "promo", body: "Promo hari ini" },
  });
  const audience = await db.audience.create({ data: { name: "Test Audience", type: "Manual" } });
  const customer = await db.customer.create({
    data: {
      name: "Buyer",
      phone: "+628111111111",
      audiences: { connect: { id: audience.id } },
    },
  });
  const conversation = await db.conversation.create({
    data: {
      customerId: customer.id,
      deviceId: device.id,
      lastInboundAt: new Date(),
      lastMessageAt: new Date(),
    },
  });
  await db.message.create({
    data: { conversationId: conversation.id, direction: "in", sender: "customer", text: "Halo", status: "read" },
  });

  const generated = generateApiToken();
  await db.apiToken.create({
    data: {
      name: "Smoke token",
      prefix: generated.prefix,
      tokenHash: generated.tokenHash,
      scopes: "*",
      userId: user.id,
    },
  });
  const token = generated.token;

  // 1. Authentication
  let result = await call(meGet, token, "/api/v1/me");
  assert.equal(result.res.status, 200, "GET /me");
  assert.equal((result.json.data as Json).token && ((result.json.data as Json).token as Json).name, "Smoke token");
  console.log("✓ GET /me");

  // 2. Contacts CRUD
  result = await call(contactsGet, token, "/api/v1/contacts");
  assert.equal(result.res.status, 200, "GET /contacts");
  result = await call(contactsPost, token, "/api/v1/contacts", {
    method: "POST",
    body: { phone_e164: "081234567890", first_name: "Ibu Sari", opt_in_whatsapp: true },
  });
  assert.equal(result.res.status, 201, "POST /contacts");
  const contactId = Number((result.json.data as Json).id);
  assert.ok(contactId > 0);
  result = await call(contactPatch, token, `/api/v1/contacts/${contactId}`, {
    method: "PATCH",
    body: { notes: "Dari smoke test" },
    params: { id: String(contactId) },
  });
  assert.equal(result.res.status, 200, "PATCH /contacts/{id}");
  assert.equal((result.json.data as Json).notes, "Dari smoke test");
  console.log("✓ contacts CRUD");

  // 3. Segments
  result = await call(segmentsGet, token, "/api/v1/segments");
  assert.equal(result.res.status, 200, "GET /segments");
  result = await call(segmentsPost, token, "/api/v1/segments", {
    method: "POST",
    body: { name: "Segment Smoke", contact_ids: [contactId] },
  });
  assert.equal(result.res.status, 201, "POST /segments");
  const segmentId = Number((result.json.data as Json).id);
  result = await call(segmentContactsGet, token, `/api/v1/segments/${segmentId}/contacts`, {
    params: { id: String(segmentId) },
  });
  assert.equal(result.res.status, 200, "GET /segments/{id}/contacts");
  assert.ok((result.json.data as unknown[]).length >= 1);
  console.log("✓ segments");

  // 4. Conversations + messages
  result = await call(conversationsGet, token, "/api/v1/conversations");
  assert.equal(result.res.status, 200, "GET /conversations");
  result = await call(messagesGet, token, `/api/v1/conversations/${conversation.id}/messages`, {
    params: { id: String(conversation.id) },
  });
  assert.equal(result.res.status, 200, "GET /conversations/{id}/messages");
  assert.ok((result.json.data as unknown[]).length >= 1);
  console.log("✓ conversations");

  // 5. Send a (simulated) message
  result = await call(sendMessagePost, token, "/api/v1/messages/send", {
    method: "POST",
    body: { contact_id: customer.id, channel: "whatsapp", body: "Halo dari API!" },
  });
  assert.equal(result.res.status, 201, "POST /messages/send");
  assert.equal((result.json.data as Json).status, "simulated");
  console.log("✓ messages/send (simulated)");

  // 6. Campaign create + launch + recipients
  result = await call(campaignsGet, token, "/api/v1/campaigns");
  assert.equal(result.res.status, 200, "GET /campaigns");
  result = await call(campaignsPost, token, "/api/v1/campaigns", {
    method: "POST",
    body: { name: "Smoke Campaign", device_id: device.id, audience_id: audience.id, template_ids: [template.id] },
  });
  assert.equal(result.res.status, 201, "POST /campaigns");
  const campaignId = Number((result.json.data as Json).id);
  result = await call(launchPost, token, `/api/v1/campaigns/${campaignId}/launch`, {
    method: "POST",
    params: { id: String(campaignId) },
  });
  assert.equal(result.res.status, 200, "POST /campaigns/{id}/launch");
  assert.equal((result.json.meta as Json).status, "Terkirim");
  result = await call(recipientsGet, token, `/api/v1/campaigns/${campaignId}/recipients`, {
    params: { id: String(campaignId) },
  });
  assert.equal(result.res.status, 200, "GET /campaigns/{id}/recipients");
  assert.ok((result.json.data as unknown[]).length >= 1);
  console.log("✓ campaigns create/launch/recipients");

  // 7. Outbound webhooks: create endpoint + receive a signed test.ping
  let received: { raw: string; headers: Record<string, string | undefined> } | null = null;
  const receiver = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      received = { raw, headers: req.headers as Record<string, string | undefined> };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => receiver.listen(4011, "127.0.0.1", () => resolve()));

  result = await call(webhooksPost, token, "/api/v1/webhooks", {
    method: "POST",
    body: { name: "Smoke receiver", url: "http://127.0.0.1:4011/hook", events: [] },
  });
  assert.equal(result.res.status, 201, "POST /webhooks");
  const webhookId = Number((result.json.data as Json).id);
  const secret = String((result.json.data as Json).secret);
  assert.ok(secret.startsWith("whsec_"));
  const delivery = await sendTestWebhook(webhookId);
  assert.equal(delivery.success, true);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const captured = received as { raw: string; headers: Record<string, string | undefined> } | null;
  assert.ok(captured, "receiver got the delivery");
  assert.equal(captured.headers["x-webhook-event"], "test.ping");
  assert.equal(
    verifyWebhookSignature(
      captured.raw,
      captured.headers["x-webhook-signature"] ?? null,
      secret,
    ),
    true,
    "receiver verifies the HMAC",
  );
  const deliveryCount = await db.webhookDelivery.count({ where: { endpointId: webhookId } });
  assert.equal(deliveryCount, 1);
  receiver.close();
  console.log("✓ webhooks create/test/signature/delivery log");

  // 8. Wallet + analytics + OpenAPI
  result = await call(walletGet, token, "/api/v1/wallet");
  assert.equal(result.res.status, 200, "GET /wallet");
  result = await call(transactionsGet, token, "/api/v1/wallet/transactions");
  assert.equal(result.res.status, 200, "GET /wallet/transactions");
  result = await call(analyticsGet, token, "/api/v1/analytics/summary");
  assert.equal(result.res.status, 200, "GET /analytics/summary");
  result = await call(openapiGet, token, "/api/v1/openapi.json");
  assert.equal(result.res.status, 200, "GET /openapi.json");
  assert.equal(result.json.openapi, "3.1.0");
  console.log("✓ wallet/analytics/openapi");

  // 9. Scoped token cannot call a full-access endpoint
  const scopedGenerated = generateApiToken();
  await db.apiToken.create({
    data: {
      name: "Scoped token",
      prefix: scopedGenerated.prefix,
      tokenHash: scopedGenerated.tokenHash,
      scopes: "contacts:read",
      userId: user.id,
    },
  });
  result = await call(
    async (req: Request) => {
      const { GET } = await import("../src/app/api/v1/tokens/route");
      return GET(req);
    },
    scopedGenerated.token,
    "/api/v1/tokens",
  );
  assert.equal(result.res.status, 403, "scoped token cannot list tokens");
  assert.equal((result.json as Json).required_scope, "*");
  result = await call(contactsGet, scopedGenerated.token, "/api/v1/contacts");
  assert.equal(result.res.status, 200, "scoped token can read contacts");
  result = await call(contactsPost, scopedGenerated.token, "/api/v1/contacts", {
    method: "POST",
    body: { phone_e164: "081200000000", first_name: "Blocked" },
  });
  assert.equal(result.res.status, 403, "scoped token cannot write contacts");
  console.log("✓ scopes enforced");

  // 10. Delete the created contact (cascade smoke)
  result = await call(contactDelete, token, `/api/v1/contacts/${contactId}`, {
    method: "DELETE",
    params: { id: String(contactId) },
  });
  assert.equal(result.res.status, 204, "DELETE /contacts/{id}");

  await db.$disconnect();
  console.log("\nAPI smoke test passed.");
}

main().catch(async (e) => {
  console.error("API smoke test failed:", e);
  await db.$disconnect();
  process.exit(1);
});
