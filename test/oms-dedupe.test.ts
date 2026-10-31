import { describe, expect, it } from "vitest";
import {
  aiCheckoutExternalId,
  orderFingerprint,
  staffCheckoutExternalId,
  storedFingerprint,
  wibDay,
} from "@/lib/oms/dedupe";

const base = {
  metode_bayar: "cod" as const,
  penerima: { nama: "Budi", no_wa: "6280000000001" },
  alamat: { alamat: "Jl. Mawar No. 5", kecamatan: "Coblong", kota: "Bandung", provinsi: "Jawa Barat", kode_pos: "40132" },
  items: [
    { sku: "SKU-A", qty: 1 },
    { sku: "SKU-B", qty: 2 },
  ],
};

describe("orderFingerprint", () => {
  it("ignores item order, letter case and punctuation in the address", () => {
    const shuffled = {
      ...base,
      alamat: { ...base.alamat, alamat: "jl mawar no 5", kota: "BANDUNG" },
      items: [
        { sku: "sku-b", qty: 2 },
        { sku: "SKU-A", qty: 1 },
      ],
    };
    expect(orderFingerprint(shuffled)).toBe(orderFingerprint(base));
  });

  it("changes when quantity, payment method or address changes", () => {
    const fp = orderFingerprint(base);
    expect(orderFingerprint({ ...base, items: [{ sku: "SKU-A", qty: 2 }, base.items[1]] })).not.toBe(fp);
    expect(orderFingerprint({ ...base, metode_bayar: "transfer" })).not.toBe(fp);
    expect(orderFingerprint({ ...base, alamat: { ...base.alamat, alamat: "Jl. Melati 1" } })).not.toBe(fp);
  });

  it("reads stored payloads and tolerates broken JSON", () => {
    expect(storedFingerprint(JSON.stringify(base))).toBe(orderFingerprint(base));
    expect(storedFingerprint("{oops")).toBeNull();
  });
});

describe("external ids", () => {
  it("uses the WIB calendar day", () => {
    expect(wibDay(new Date("2026-10-31T16:59:00Z"))).toBe("20261031");
    expect(wibDay(new Date("2026-10-31T17:00:00Z"))).toBe("20261101");
  });

  it("is stable for the same AI order on the same day", () => {
    const at = new Date("2026-10-31T03:00:00Z");
    const fp = orderFingerprint(base);
    expect(aiCheckoutExternalId(9, fp, at)).toBe(aiCheckoutExternalId(9, fp, new Date("2026-10-31T10:00:00Z")));
    expect(aiCheckoutExternalId(9, fp, at)).toMatch(/^chk_9_ai_[0-9a-f]{16}_20261031$/);
    expect(aiCheckoutExternalId(9, fp, at).length).toBeLessThanOrEqual(100);
  });

  it("requires a UUID nonce for staff forms", () => {
    const nonce = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
    expect(staffCheckoutExternalId(4, nonce)).toBe(`chk_4_${nonce}`);
    expect(() => staffCheckoutExternalId(4, "")).toThrow(/kedaluwarsa/);
    expect(() => staffCheckoutExternalId(4, "../../x")).toThrow();
  });
});
