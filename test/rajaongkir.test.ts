import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDestinationCache,
  fetchDestinations,
  fetchDomesticCost,
  RajaOngkirError,
} from "@/lib/rajaongkir";

const calls: { url: string; init: RequestInit }[] = [];

function mockFetch(body: unknown, status = 200) {
  calls.length = 0;
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
}

beforeEach(() => clearDestinationCache());

afterEach(() => {
  vi.unstubAllGlobals();
  clearDestinationCache();
});

describe("rajaongkir", () => {
  it("searches domestic destinations with the key header and maps the rows", async () => {
    mockFetch({
      meta: { message: "Success Get Domestic Destinations", code: 200, status: "success" },
      data: [
        {
          id: 47422,
          label: "Sukajadi, Sukajadi, Bandung, Jawa Barat",
          province_name: "Jawa Barat",
          city_name: "Bandung",
          district_name: "Sukajadi",
          subdistrict_name: "Sukajadi",
          zip_code: "40162",
        },
      ],
    });

    const rows = await fetchDestinations("raja-key", "sukajadi bandung");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://rajaongkir.komerce.id/api/v1/destination/domestic-destination?search=sukajadi+bandung&limit=10&offset=0",
    );
    expect((calls[0].init.headers as Record<string, string>).key).toBe("raja-key");
    expect(rows[0]).toMatchObject({ id: 47422, city_name: "Bandung", zip_code: "40162" });
  });

  it("caches destination searches", async () => {
    mockFetch({ meta: { status: "success", code: 200 }, data: [] });
    await fetchDestinations("raja-key", "bandung");
    await fetchDestinations("raja-key", "bandung");
    expect(calls).toHaveLength(1);
  });

  it("posts the cost form and returns the cheapest first", async () => {
    mockFetch({
      meta: { message: "Success Calculate Domestic Shipping cost", code: 200, status: "success" },
      data: [
        { name: "JNE", code: "jne", service: "REG", description: "Reguler", cost: 18000, etd: "2-3 hari" },
        { name: "JNE", code: "jne", service: "YES", description: "Yakin Esok Sampai", cost: 26000, etd: "1 hari" },
      ],
    });

    const rows = await fetchDomesticCost("raja-key", {
      origin: 47422,
      destination: 12422,
      weight: 1000,
      courier: "jne",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://rajaongkir.komerce.id/api/v1/calculate/domestic-cost");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(String(calls[0].init.body)).toBe("origin=47422&destination=12422&weight=1000&courier=jne&price=lowest");
    expect(rows.map((r) => r.cost)).toEqual([18000, 26000]);
  });

  it("maps a 401 to an invalid-key message", async () => {
    mockFetch({ meta: { message: "Invalid API key", code: 401, status: "error" }, data: null }, 401);
    const error = await fetchDestinations("bad", "bandung").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RajaOngkirError);
    expect((error as RajaOngkirError).status).toBe(401);
    expect((error as RajaOngkirError).message).toMatch(/API key/i);
  });

  it("maps a meta error body to RajaOngkirError", async () => {
    mockFetch({ meta: { message: "Domestic Destinations Data not found", code: 404, status: "error" }, data: null }, 200);
    const error = await fetchDestinations("raja-key", "tidak-ada").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RajaOngkirError);
    expect((error as RajaOngkirError).code).toBe("404");
  });

  it("validates weight before calling the API", async () => {
    mockFetch({ data: [] });
    await expect(
      fetchDomesticCost("raja-key", { origin: 1, destination: 2, weight: 0, courier: "jne" }),
    ).rejects.toThrow(/Berat/);
    expect(calls).toHaveLength(0);
  });
});
