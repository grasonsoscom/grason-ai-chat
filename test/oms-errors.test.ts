import { describe, expect, it } from "vitest";
import { OmsApiError, OmsNetworkError, OmsNotConfiguredError } from "@/lib/oms/client";
import { friendlyOmsError } from "@/lib/oms/errors";

describe("friendlyOmsError", () => {
  it("shows available stock for stok_tidak_cukup", () => {
    const text = friendlyOmsError(
      new OmsApiError(422, "stok_tidak_cukup", "Stok tidak cukup", [
        { sku: "BSR-01", diminta: 3, tersedia: 1 },
      ]),
    );
    expect(text).toContain("BSR-01");
    expect(text).toContain("tersedia 1");
  });

  it("explains auth and permission failures", () => {
    expect(friendlyOmsError(new OmsApiError(401, "tidak_terautentikasi", "x"))).toMatch(/API key/);
    expect(friendlyOmsError(new OmsApiError(403, "tidak_diizinkan", "x"))).toMatch(/izin/);
  });

  it("explains human verification and COD mismatch", () => {
    expect(friendlyOmsError(new OmsApiError(422, "perlu_verifikasi_manusia", "x"))).toMatch(/CS manusia/);
    expect(friendlyOmsError(new OmsApiError(422, "nilai_cod_tidak_cocok", "x"))).toMatch(/COD/);
  });

  it("explains v2 total and breakdown mismatches", () => {
    expect(friendlyOmsError(new OmsApiError(422, "total_tidak_cocok", "x"))).toMatch(/harga aktif OMS/);
    expect(friendlyOmsError(new OmsApiError(422, "rincian_tidak_valid", "x"))).toMatch(/subsidi\/COD/);
    expect(friendlyOmsError(new OmsApiError(422, "diskon_melebihi_subtotal", "x"))).toMatch(/Diskon/);
  });

  it("handles network and missing configuration", () => {
    expect(friendlyOmsError(new OmsNetworkError("down"))).toMatch(/tidak dapat dihubungi/i);
    expect(friendlyOmsError(new OmsNotConfiguredError())).toMatch(/OMS_BASE_URL/);
  });
});
