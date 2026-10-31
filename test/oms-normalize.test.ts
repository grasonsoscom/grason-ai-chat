import { describe, expect, it } from "vitest";
import {
  assertRupiah,
  checkoutExternalId,
  isRetryableStatus,
  isRupiah,
  leadExternalId,
  normalizePhone,
} from "@/lib/oms/normalize";

describe("normalizePhone", () => {
  it.each([
    ["081234567890", "6281234567890"],
    ["+62 812-3456-7890", "6281234567890"],
    ["6281234567890", "6281234567890"],
    ["81234567890", "6281234567890"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it("rejects an empty number", () => {
    expect(() => normalizePhone("  ")).toThrow();
  });
});

describe("rupiah", () => {
  it("accepts non-negative integers only", () => {
    expect(isRupiah(0)).toBe(true);
    expect(isRupiah(95000)).toBe(true);
    expect(isRupiah(95000.5)).toBe(false);
    expect(isRupiah(-1)).toBe(false);
    expect(isRupiah("95000")).toBe(false);
  });

  it("assertRupiah throws a readable message", () => {
    expect(assertRupiah(15000, "Ongkir")).toBe(15000);
    expect(() => assertRupiah(1.5, "Ongkir")).toThrow(/Ongkir/);
  });
});

describe("external ids", () => {
  it("uses a stable lead id per conversation", () => {
    expect(leadExternalId(42)).toBe("conv_42");
  });

  it("creates a checkout id below the 100 character limit", () => {
    const id = checkoutExternalId(42);
    expect(id.startsWith("chk_42_")).toBe(true);
    expect(id.length).toBeLessThan(100);
  });
});

describe("isRetryableStatus", () => {
  it("retries 429 and 5xx", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(422)).toBe(false);
  });
});
