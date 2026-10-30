import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "crypto";
import { codQuote } from "./promo";
import { conversationIdFromLead, leadExternalId, oms, OmsError, orderAmounts, verifyOmsSignature } from "./oms";

process.env.OMS_BASE_URL = "https://oms.test/api/v2/";
process.env.OMS_API_KEY = "gok_test_dummy";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

test("HMAC test vector from the OMS integration guide", () => {
  const sig = "sha256=cf240dd54798699c0c9fb379a4d91e84b9c06d20bc1d399ba612925dbe60a6b4";
  assert.equal(verifyOmsSignature("k", "1793170000", '{"a":1}', sig, 1793170000), true);
  assert.equal(verifyOmsSignature("k", "1793170000", '{"a":2}', sig, 1793170000), false);
  assert.equal(verifyOmsSignature("x", "1793170000", '{"a":1}', sig, 1793170000), false);
  assert.equal(verifyOmsSignature("k", "1793170000", '{"a":1}', sig.slice(0, -1), 1793170000), false);
  assert.equal(verifyOmsSignature("k", "1793170000", '{"a":1}', null, 1793170000), false);
});

test("signature older or newer than 5 minutes is rejected", () => {
  const sig = "sha256=cf240dd54798699c0c9fb379a4d91e84b9c06d20bc1d399ba612925dbe60a6b4";
  assert.equal(verifyOmsSignature("k", "1793170000", '{"a":1}', sig, 1793170000 + 300), true);
  assert.equal(verifyOmsSignature("k", "1793170000", '{"a":1}', sig, 1793170000 + 301), false);
  assert.equal(verifyOmsSignature("k", "1793170000", '{"a":1}', sig, 1793170000 - 301), false);
  assert.equal(verifyOmsSignature("k", null, '{"a":1}', sig, 1793170000), false);
  assert.equal(verifyOmsSignature("k", "abc", '{"a":1}', sig, 1793170000), false);
});

test("lead external_id round trip", () => {
  assert.equal(leadExternalId(42), "conv-42");
  assert.equal(conversationIdFromLead("conv-42"), 42);
  assert.equal(conversationIdFromLead("checkout-42"), null);
  assert.equal(conversationIdFromLead(null), null);
});

test("COD amounts come from codQuote and satisfy the OMS total check", () => {
  for (const [price, ongkir, segment, region] of [
    [75_000, 30_000, "nc", "jawa"], [100_000, 30_000, "nc", "jawa"], [150_000, 60_000, "nc", "luar"],
    [150_000, 40_000, "ro", "luar"], [250_000, 20_000, "reseller", "jawa"],
  ] as const) {
    const q = codQuote(price, ongkir, segment, region);
    const a = orderAmounts("cod", price, ongkir, q);
    assert.deepEqual(a, { ongkir, subsidi_ongkir: q.shippingSubsidy, biaya_cod: q.codFee, subsidi_admin_cod: q.adminSubsidy, total: q.total });
    assert.equal(a.total, price - 0 + a.ongkir - a.subsidi_ongkir + a.biaya_cod - a.subsidi_admin_cod);
    assert.ok(a.subsidi_ongkir <= a.ongkir && a.subsidi_admin_cod <= a.biaya_cod);
  }
});

test("transfer orders carry no COD fee or subsidy", () => {
  assert.deepEqual(orderAmounts("transfer", 100_000, 30_000), { ongkir: 30_000, subsidi_ongkir: 0, biaya_cod: 0, subsidi_admin_cod: 0, total: 130_000 });
  assert.throws(() => orderAmounts("cod", 100_000, 30_000));
});

test("requests send the API key and JSON body", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const lead = await oms.createLead(
    { external_id: "conv-1", no_wa: "+620000000000", masuk_at: "2026-10-30T07:05:00Z" },
    { fetch: async (url, init) => { seen = { url: String(url), init: init! }; return json(201, { id: "lead-uuid" }); } },
  );
  assert.equal(lead.id, "lead-uuid");
  assert.equal(seen!.url, "https://oms.test/api/v2/leads");
  assert.equal(seen!.init.method, "POST");
  assert.equal((seen!.init.headers as Record<string, string>)["X-Api-Key"], "gok_test_dummy");
  assert.equal(JSON.parse(seen!.init.body as string).external_id, "conv-1");
});

test("stock query joins SKUs", async () => {
  let url = "";
  const data = await oms.stock(["VVG-01", "KKT-P2"], { fetch: async (u) => { url = String(u); return json(200, { data: [] }); } });
  assert.deepEqual(data, []);
  assert.equal(url, "https://oms.test/api/v2/stock?sku=VVG-01%2CKKT-P2");
});

test("429 with a short Retry-After waits and retries once", async () => {
  const waits: number[] = [];
  let calls = 0;
  const prices = await oms.prices({
    fetch: async () => (++calls === 1 ? json(429, { error: { kode: "terlalu_banyak_permintaan", pesan: "x" } }, { "Retry-After": "2" }) : json(200, { data: [{ sku: "A" }] })),
    sleep: async (ms) => { waits.push(ms); },
  });
  assert.equal(calls, 2);
  assert.deepEqual(waits, [2000]);
  assert.equal(prices[0].sku, "A");
});

test("429 with a long Retry-After is reported, not waited", async () => {
  await assert.rejects(
    oms.prices({ fetch: async () => json(429, { error: { kode: "terlalu_banyak_permintaan", pesan: "x" } }, { "Retry-After": "40" }), sleep: async () => assert.fail("must not wait") }),
    (e: unknown) => e instanceof OmsError && e.status === 429 && e.retryAfter === 40 && /40 detik/.test(e.message),
  );
});

test("422 stok_tidak_cukup and total_tidak_cocok give clear messages", async () => {
  await assert.rejects(
    oms.createOrder({} as never, { fetch: async () => json(422, { error: { kode: "stok_tidak_cukup", pesan: "Stok tidak cukup", detail: [{ sku: "KKT-01", diminta: 3, tersedia: 1 }] } }) }),
    (e: unknown) => e instanceof OmsError && e.kode === "stok_tidak_cukup" && e.message.includes("KKT-01 diminta 3, tersedia 1"),
  );
  await assert.rejects(
    oms.createOrder({} as never, { fetch: async () => json(422, { error: { kode: "total_tidak_cocok", pesan: "x", detail: { total_dikirim: 100_000, total_oms: 105_000 } } }) }),
    (e: unknown) => e instanceof OmsError && e.kode === "total_tidak_cocok" && e.message.includes("dikirim 100000, OMS 105000"),
  );
});

test("network failure and missing config", async () => {
  await assert.rejects(oms.getOrder("x", { fetch: async () => { throw new TypeError("fetch failed"); } }), (e: unknown) => e instanceof OmsError && e.kode === "tidak_terhubung");
  const base = process.env.OMS_BASE_URL;
  delete process.env.OMS_BASE_URL;
  await assert.rejects(oms.getOrder("x"), /belum dikonfigurasi/);
  process.env.OMS_BASE_URL = base;
});

test("webhook route rejects a bad signature with 400 and a missing secret with 500", async () => {
  const { POST } = await import("../app/api/webhooks/oms/route");
  const body = JSON.stringify({ event_id: "e1", jenis: "order.status_changed", terjadi_at: "2026-10-30T07:05:00Z", data: { order_id: "o1", status: "dikirim" } });
  const ts = String(Math.floor(Date.now() / 1000));
  const req = (sig: string) => new Request("https://x/api/webhooks/oms", { method: "POST", body, headers: { "x-oms-timestamp": ts, "x-oms-signature": sig } });

  delete process.env.OMS_WEBHOOK_SECRET;
  assert.equal((await POST(req("sha256=00"))).status, 500);

  process.env.OMS_WEBHOOK_SECRET = "k";
  assert.equal((await POST(req("sha256=00"))).status, 400);
  const wrongKey = `sha256=${createHmac("sha256", "other").update(`${ts}.${body}`).digest("hex")}`;
  assert.equal((await POST(req(wrongKey))).status, 400);

  // Valid signature, but a non-JSON body still gets a final 400 (no DB access).
  const badBody = "not json";
  const sig = `sha256=${createHmac("sha256", "k").update(`${ts}.${badBody}`).digest("hex")}`;
  const res = await POST(new Request("https://x/api/webhooks/oms", { method: "POST", body: badBody, headers: { "x-oms-timestamp": ts, "x-oms-signature": sig } }));
  assert.equal(res.status, 400);
});
