// Minimal OMS GRASON mock for local integration testing.
// Implements the operations used by this app from docs/oms/cs-ai.v1.yaml.
// Run: node scripts/oms-mock-server.mjs  (default port 4010)
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.OMS_MOCK_PORT ?? 4010);
const API_KEY = process.env.OMS_MOCK_API_KEY ?? "gok_test_secret";

const prices = [
  { sku: "BSR-01", nama: "Bio Serea", tipe: "satuan", entitas: "FHI", harga_jual: 95000 },
  { sku: "VVG-01", nama: "Vivagoat", tipe: "satuan", entitas: "SSR", harga_jual: 49500 },
  {
    sku: "BSR-P2",
    nama: "Bio Serea Paket 2",
    tipe: "paket",
    entitas: "FHI",
    harga_jual: 180000,
    komponen: [{ sku: "BSR-01", qty: 2 }],
  },
];
const priceBySku = new Map(prices.map((p) => [p.sku, p]));
const stock = new Map(prices.map((p) => [p.sku, { sku: p.sku, nama: p.nama, tipe: p.tipe, tersedia: 10, diperbarui_at: new Date().toISOString() }]));

const leadsByExternal = new Map();
const leadsById = new Map();
const checkoutsByExternal = new Map();
const ordersById = new Map();
let orderSeq = 0;

const now = () => new Date().toISOString();
const normalizePhone = (input) => {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
};

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function fail(res, status, kode, pesan, detail) {
  send(res, status, { error: { kode, pesan, ...(detail ? { detail } : {}) } });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  if (path === "/__state") {
    return send(res, 200, {
      leads: [...leadsById.values()],
      checkouts: [...checkoutsByExternal.values()],
      orders: [...ordersById.values()],
    });
  }
  // v1 and v2 share the same endpoints; v2 adds COD breakdown and segmen.
  const versionMatch = path.match(/^\/api\/v([12])(\/.*)?$/);
  if (!versionMatch) {
    return send(res, 404, { error: { kode: "tidak_ditemukan", pesan: "Not found" } });
  }
  const version = Number(versionMatch[1]);
  const route = versionMatch[2] ?? "";

  // Health/info for the browser and the OMS simulator's `/api/vN/health` probe.
  if (route === "" || route === "/health") {
    return send(res, 200, {
      status: "ok",
      service: "oms-mock",
      version,
      auth: "Authorization: Bearer gok_test_secret",
      endpoints: [
        `GET /api/v${version}/prices`,
        `GET /api/v${version}/stock?sku=BSR-01,VVG-01`,
        `POST /api/v${version}/leads`,
        `PATCH /api/v${version}/leads/{id}`,
        `POST /api/v${version}/orders`,
        `GET /api/v${version}/orders/{id}`,
        `POST /api/v${version}/orders/{id}/verifikasi`,
        "GET /__state",
      ],
    });
  }

  if (req.headers.authorization !== `Bearer ${API_KEY}`) {
    return fail(res, 401, "tidak_terautentikasi", "API key salah atau tidak ada");
  }

  if (req.method === "GET" && route === "/prices") return send(res, 200, { data: prices });

  if (req.method === "GET" && route === "/stock") {
    const wanted = (url.searchParams.get("sku") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    return send(res, 200, { data: wanted.length ? wanted.map((sku) => stock.get(sku)).filter(Boolean) : [...stock.values()] });
  }

  if (req.method === "POST" && route === "/leads") {
    const body = await readBody(req);
    const existing = leadsByExternal.get(body.external_id);
    if (existing) return send(res, 200, existing);
    const lead = {
      id: randomUUID(),
      external_id: body.external_id,
      no_wa: normalizePhone(body.no_wa),
      nama: body.nama ?? null,
      agen: "cs_ai",
      status: "baru",
      handover: false,
      handover_at: null,
      masuk_at: body.masuk_at ?? now(),
      respon_pertama_at: null,
      kanal: body.kanal ?? "organik",
      campaign_id: body.campaign_id ?? null,
      adset_id: body.adset_id ?? null,
      ad_id: body.ad_id ?? null,
      segmen: body.segmen ?? null,
    };
    leadsByExternal.set(lead.external_id, lead);
    leadsById.set(lead.id, lead);
    return send(res, 201, lead);
  }

  const leadMatch = route.match(/^\/leads\/([^/]+)$/);
  if (leadMatch && (req.method === "GET" || req.method === "PATCH")) {
    const lead = leadsById.get(leadMatch[1]);
    if (!lead) return fail(res, 404, "tidak_ditemukan", "Lead tidak ditemukan");
    if (req.method === "GET") return send(res, 200, lead);

    const body = await readBody(req);
    if (body.status === "closing") return fail(res, 409, "closing_lewat_order", "Status closing diisi otomatis saat order dibuat");
    if (lead.status === "closing") return fail(res, 409, "lead_sudah_closing", "Lead sudah closing");
    if (body.status) lead.status = body.status;
    if (body.respon_pertama_at && !lead.respon_pertama_at) lead.respon_pertama_at = body.respon_pertama_at;
    if (body.handover) {
      lead.handover = true;
      lead.handover_at = body.handover.terjadi_at ?? now();
    }
    return send(res, 200, lead);
  }

  if (req.method === "POST" && route === "/orders") {
    const body = await readBody(req);
    const existing = checkoutsByExternal.get(body.external_id);
    if (existing) return send(res, 200, existing);

    const lead = leadsById.get(body.lead_id);
    if (!lead) return fail(res, 404, "lead_tidak_ditemukan", "Lead tidak ditemukan");

    const grouped = new Map();
    let subtotalTotal = 0;
    for (const item of body.items ?? []) {
      const product = priceBySku.get(item.sku);
      if (!product) return fail(res, 422, "sku_tidak_dikenal", "SKU tidak dikenal", [{ sku: item.sku }]);
      const available = stock.get(item.sku)?.tersedia ?? 0;
      if (item.qty > available) {
        return fail(res, 422, "stok_tidak_cukup", "Stok tidak cukup", [
          { sku: item.sku, diminta: item.qty, tersedia: available },
        ]);
      }
      const lineSubtotal = product.harga_jual * item.qty;
      subtotalTotal += lineSubtotal;
      const list = grouped.get(product.entitas) ?? [];
      list.push({
        sku: product.sku,
        nama: product.nama,
        qty: item.qty,
        harga_satuan: product.harga_jual,
        diskon: 0,
        subtotal: lineSubtotal,
      });
      grouped.set(product.entitas, list);
    }
    if (!grouped.size) return fail(res, 400, "validasi_gagal", "Items wajib diisi");

    const diskon = Number(body.diskon ?? 0);
    const ongkir = Number(body.ongkir ?? 0);
    const subsidiOngkir = version === 2 ? Number(body.subsidi_ongkir ?? 0) : 0;
    const biayaCod = version === 2 ? Number(body.biaya_cod ?? 0) : 0;
    const subsidiAdminCod = version === 2 ? Number(body.subsidi_admin_cod ?? 0) : 0;

    if (version === 2) {
      const rupiah = (value) => Number.isInteger(value) && value >= 0;
      if (![diskon, ongkir, subsidiOngkir, biayaCod, subsidiAdminCod, body.total].every(rupiah)) {
        return fail(res, 422, "validasi_gagal", "Rincian harga tidak valid");
      }
      if (subsidiOngkir > ongkir) {
        return fail(res, 422, "rincian_tidak_valid", "Subsidi ongkir melebihi ongkir");
      }
      if (subsidiAdminCod > biayaCod) {
        return fail(res, 422, "rincian_tidak_valid", "Subsidi admin COD melebihi biaya COD");
      }
      if (body.metode_bayar !== "cod" && biayaCod > 0) {
        return fail(res, 422, "rincian_tidak_valid", "Biaya COD hanya untuk order COD");
      }
      if (diskon > subtotalTotal) {
        return fail(res, 422, "diskon_melebihi_subtotal", "Diskon melebihi subtotal checkout");
      }
      const expected = subtotalTotal - diskon + ongkir - subsidiOngkir + biayaCod - subsidiAdminCod;
      if (body.total !== expected) {
        return fail(res, 422, "total_tidak_cocok", "Total tidak sama dengan hitungan OMS", {
          total_dikirim: body.total,
          total_oms: expected,
          subtotal_oms: subtotalTotal,
        });
      }
    }

    const groupId = randomUUID();
    const orders = [...grouped.entries()].map(([entitas, items], index) => {
      const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
      // The mock puts checkout-level adjustments on the first order. The real
      // OMS splits them by weight/subtotal, but the sum of totals is identical.
      const ongkirOrder = index === 0 ? ongkir : 0;
      const diskonOrder = index === 0 ? diskon : 0;
      const subsidiOngkirOrder = index === 0 ? subsidiOngkir : 0;
      const biayaCodOrder = index === 0 ? biayaCod : 0;
      const subsidiAdminOrder = index === 0 ? subsidiAdminCod : 0;
      const total =
        subtotal - diskonOrder + ongkirOrder - subsidiOngkirOrder + biayaCodOrder - subsidiAdminOrder;
      orderSeq++;
      const order = {
        id: randomUUID(),
        nomor: `GRS-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(orderSeq).padStart(4, "0")}`,
        order_group_id: groupId,
        external_id: body.external_id,
        lead_id: lead.id,
        entitas,
        status: "baru",
        metode_bayar: body.metode_bayar,
        perlu_verifikasi_manusia: false,
        subtotal,
        diskon: diskonOrder,
        ongkir: ongkirOrder,
        ...(version === 2
          ? {
              subsidi_ongkir: subsidiOngkirOrder,
              biaya_cod: biayaCodOrder,
              subsidi_admin_cod: subsidiAdminOrder,
              segmen: body.segmen ?? lead.segmen ?? null,
            }
          : {}),
        total,
        nilai_cod: body.metode_bayar === "cod" ? total : 0,
        items,
        pengiriman: null,
        dibuat_at: now(),
        terverifikasi_at: null,
      };
      ordersById.set(order.id, order);
      return order;
    });

    const checkout = { order_group_id: groupId, external_id: body.external_id, orders };
    checkoutsByExternal.set(body.external_id, checkout);
    return send(res, 201, checkout);
  }

  const orderMatch = route.match(/^\/orders\/([^/]+)$/);
  if (orderMatch && req.method === "GET") {
    const order = ordersById.get(orderMatch[1]);
    return order ? send(res, 200, order) : fail(res, 404, "tidak_ditemukan", "Order tidak ditemukan");
  }

  const verifyMatch = route.match(/^\/orders\/([^/]+)\/verifikasi$/);
  if (verifyMatch && req.method === "POST") {
    const order = ordersById.get(verifyMatch[1]);
    if (!order) return fail(res, 404, "tidak_ditemukan", "Order tidak ditemukan");
    if (order.status !== "baru") return fail(res, 409, "status_tidak_sesuai", "Order sudah melewati verifikasi");
    const body = await readBody(req);
    if (Number(body.nilai_cod_dikonfirmasi) !== order.nilai_cod) {
      return fail(res, 422, "nilai_cod_tidak_cocok", "Nilai COD tidak cocok");
    }
    order.status = "terverifikasi";
    order.terverifikasi_at = now();
    return send(res, 200, order);
  }

  return fail(res, 404, "tidak_ditemukan", "Endpoint tidak ditemukan");
});

server.listen(PORT, () => {
  console.log(`[oms-mock] listening on http://127.0.0.1:${PORT}/api/v1`);
});
