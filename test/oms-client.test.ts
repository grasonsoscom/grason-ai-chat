import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OmsApiError, createLead, getStock, omsRequest } from "@/lib/oms/client";
import { json, mockOms } from "./oms-mock";

const leadResponse = {
  id: "lead-1",
  external_id: "conv_1",
  no_wa: "6281234567890",
  nama: "Ibu Sari",
  agen: "cs_ai",
  status: "baru",
  handover: false,
  handover_at: null,
  masuk_at: "2026-10-30T02:15:00.000Z",
  respon_pertama_at: null,
};

const leadInput = {
  external_id: "conv_1",
  no_wa: "6281234567890",
  masuk_at: "2026-10-30T02:15:00.000Z",
};

beforeEach(() => {
  process.env.OMS_BASE_URL = "https://oms.test/api/v1/";
  process.env.OMS_API_KEY = "gok_test_secret";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OMS_BASE_URL;
  delete process.env.OMS_API_KEY;
});

describe("omsClient", () => {
  it("POST /leads with bearer auth and snake_case body", async () => {
    const calls = mockOms(() => json(leadResponse, 201));
    const lead = await createLead(leadInput);

    expect(lead.id).toBe("lead-1");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].path).toBe("/api/v1/leads");
    expect(calls[0].headers.authorization).toBe("Bearer gok_test_secret");
    expect(calls[0].headers["content-type"]).toBe("application/json");
    expect(calls[0].body).toMatchObject(leadInput);
  });

  it("maps OMS errors to OmsApiError", async () => {
    mockOms(() => json({ error: { kode: "tidak_terautentikasi", pesan: "API key salah" } }, 401));
    const error = await createLead(leadInput).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OmsApiError);
    expect((error as OmsApiError).status).toBe(401);
    expect((error as OmsApiError).kode).toBe("tidak_terautentikasi");
  });

  it("keeps the 422 stock detail for the UI", async () => {
    mockOms(() =>
      json(
        {
          error: {
            kode: "stok_tidak_cukup",
            pesan: "Stok tidak cukup",
            detail: [{ sku: "BSR-01", diminta: 3, tersedia: 1 }],
          },
        },
        422,
      ),
    );
    const error = await createLead(leadInput).catch((e: unknown) => e);
    expect((error as OmsApiError).kode).toBe("stok_tidak_cukup");
    expect((error as OmsApiError).detail).toEqual([{ sku: "BSR-01", diminta: 3, tersedia: 1 }]);
  });

  it("retries 5xx and then succeeds", async () => {
    let call = 0;
    const calls = mockOms(() =>
      ++call === 1
        ? json({ error: { kode: "gangguan", pesan: "down" } }, 503)
        : json({ data: [] }),
    );

    const result = await omsRequest<{ data: unknown[] }>("/prices", { retries: 1, retryDelaysMs: [0] });
    expect(result.data).toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it("reuses the same external_id on repeated creates (idempotent 200)", async () => {
    const calls = mockOms(() => json(leadResponse, 200));
    await createLead(leadInput);
    await createLead(leadInput);
    expect(calls.map((c) => c.body)).toEqual([leadInput, leadInput]);
  });

  it("URL-encodes stock SKUs", async () => {
    const calls = mockOms(() => json({ data: [] }));
    await getStock(["BSR-01", "VVG-01"]);
    expect(calls[0].path).toBe("/api/v1/stock?sku=BSR-01%2CVVG-01");
  });
});
