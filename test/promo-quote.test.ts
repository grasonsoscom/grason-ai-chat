import { describe, expect, it } from "vitest";
import { minOrder, orderQuote, regionFromText } from "@/lib/promo-quote";

describe("orderQuote (OMS v2)", () => {
  it("NC Jawa: shipping and admin subsidy consume the COD fee", () => {
    const quote = orderQuote({
      subtotal: 100_000,
      ongkir: 20_000,
      diskon: 0,
      metode: "cod",
      segment: "nc",
      region: "jawa",
    });
    expect(quote.eligible).toBe(true);
    expect(quote.shippingSubsidy).toBe(20_000);
    expect(quote.codFee).toBe(3_600);
    expect(quote.adminSubsidy).toBe(3_600);
    expect(quote.total).toBe(100_000);
  });

  it("NC luar Jawa below 50k shipping gets a 50% shipping subsidy", () => {
    const quote = orderQuote({
      subtotal: 100_000,
      ongkir: 40_000,
      diskon: 0,
      metode: "cod",
      segment: "nc",
      region: "luar",
    });
    expect(quote.shippingSubsidy).toBe(20_000);
    expect(quote.codFee).toBe(4_200);
    expect(quote.adminSubsidy).toBe(4_200);
    expect(quote.total).toBe(120_000);
  });

  it("RO Jawa gets a 30k shipping subsidy and a 5k admin subsidy", () => {
    const quote = orderQuote({
      subtotal: 200_000,
      ongkir: 40_000,
      diskon: 0,
      metode: "cod",
      segment: "ro",
      region: "jawa",
    });
    expect(quote.shippingSubsidy).toBe(30_000);
    expect(quote.codFee).toBe(7_200);
    expect(quote.adminSubsidy).toBe(5_000);
    expect(quote.total).toBe(212_200);
  });

  it("reseller below the 200k minimum gets no subsidy", () => {
    const quote = orderQuote({
      subtotal: 150_000,
      ongkir: 20_000,
      diskon: 0,
      metode: "cod",
      segment: "reseller",
      region: "jawa",
    });
    expect(quote.eligible).toBe(false);
    expect(quote.shippingSubsidy).toBe(0);
    expect(quote.adminSubsidy).toBe(0);
    expect(quote.total).toBe(175_100);
  });

  it("reseller at the minimum still gets no shipping subsidy", () => {
    const quote = orderQuote({
      subtotal: 200_000,
      ongkir: 20_000,
      diskon: 0,
      metode: "cod",
      segment: "reseller",
      region: "jawa",
    });
    expect(quote.eligible).toBe(true);
    expect(quote.shippingSubsidy).toBe(0);
    expect(quote.adminSubsidy).toBe(5_000);
    expect(quote.total).toBe(221_600);
  });

  it("transfer has no COD fee or subsidy", () => {
    const quote = orderQuote({
      subtotal: 100_000,
      ongkir: 20_000,
      diskon: 10_000,
      metode: "transfer",
      segment: "nc",
      region: "jawa",
    });
    expect(quote.codFee).toBe(0);
    expect(quote.shippingSubsidy).toBe(0);
    expect(quote.adminSubsidy).toBe(0);
    expect(quote.total).toBe(110_000);
  });

  it("discount reduces the total but not the subsidy eligibility", () => {
    const quote = orderQuote({
      subtotal: 100_000,
      ongkir: 20_000,
      diskon: 10_000,
      metode: "cod",
      segment: "nc",
      region: "jawa",
    });
    expect(quote.eligible).toBe(true);
    expect(quote.total).toBe(90_000);
  });
});

describe("regionFromText", () => {
  it.each([
    ["Jawa Barat", "jawa"],
    ["DKI Jakarta", "jawa"],
    ["Bali", "luar"],
    ["Sumatera Utara", "luar"],
    ["Kalimantan Timur", "luar"],
  ])("%s -> %s", (province, expected) => {
    expect(regionFromText(province)).toBe(expected);
  });

  it("returns null for an unknown place", () => {
    expect(regionFromText("Antah Berantah")).toBeNull();
  });
});

describe("minimum order", () => {
  it("is 120k for NC/RO and 200k for reseller", () => {
    expect(minOrder("nc")).toBe(120_000);
    expect(minOrder("ro")).toBe(120_000);
    expect(minOrder("reseller")).toBe(200_000);
  });
});
