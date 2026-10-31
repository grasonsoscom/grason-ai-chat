import { describe, expect, it } from "vitest";
import {
  buildOrderContext,
  emptyOrderDraft,
  isExplicitConfirmation,
  missingOrderFields,
  type AiOrderDraft,
  type AutoOrderPlan,
} from "@/lib/ai-order";
import { guessDestinationQuery } from "@/lib/shipping";
import { formatIDR } from "@/lib/format";

const draft = (patch: Partial<AiOrderDraft>): AiOrderDraft => ({ ...emptyOrderDraft(), ...patch });

describe("ai order", () => {
  it("lists the fields that are still missing", () => {
    const missing = missingOrderFields(draft({ items: [{ sku: "BSR-01", qty: 1 }] }), null);
    expect(missing).toEqual([
      "nama penerima",
      "alamat lengkap (jalan/patokan)",
      "kecamatan",
      "kota/kabupaten",
      "provinsi",
      "metode bayar (COD atau transfer)",
      "ongkir (daerah belum bisa dihitung otomatis)",
    ]);
  });

  it("requires an explicit yes after the AI presented the total", () => {
    expect(isExplicitConfirmation("ya kak", "Total Rp150.000. Balas YA untuk membuat pesanan.")).toBe(true);
    expect(isExplicitConfirmation("ya", "Mau pesan yang mana?")).toBe(false);
    expect(isExplicitConfirmation("oke", "Stok masih ada.")).toBe(false);
    expect(isExplicitConfirmation("belum", "Total Rp150.000. Balas YA.")).toBe(false);
  });

  it("builds a confirmation prompt with the system total", () => {
    const plan: AutoOrderPlan = {
      draft: draft({
        items: [{ sku: "BSR-01", qty: 1 }],
        nama: "Sari",
        alamat: "Jl. Melati 12",
        kecamatan: "Sukajadi",
        kota: "Bandung",
        provinsi: "Jawa Barat",
        metode_bayar: "cod",
      }),
      missing: [],
      problems: [],
      quote: {
        cost: 9000,
        courier: "JNE",
        service: "REG",
        etd: "2-3 hari",
        destination: "Sukajadi, Bandung",
        weight: 1000,
        source: "rajaongkir",
      },
      subtotal: 95000,
      promo: { subtotal: 104000, eligible: false, shippingSubsidy: 0, codFee: 3120, adminSubsidy: 0, total: 107120 },
      ready: true,
      segment: "nc",
      region: "jawa",
    };

    const waiting = buildOrderContext(plan, false);
    expect(waiting).toContain(`Total: ${formatIDR(107120)}`);
    expect(waiting).toContain("Balas YA untuk membuat pesanan");
    expect(waiting).not.toContain("sudah mengonfirmasi");

    const confirmed = buildOrderContext(plan, true);
    expect(confirmed).toContain("sudah mengonfirmasi");
    expect(confirmed).toContain("Jangan mengarang nomor order");
  });
});

describe("guessDestinationQuery", () => {
  it("extracts the place from common shipping questions", () => {
    expect(guessDestinationQuery("Ongkir ke Bandung berapa ya kak?")).toBe("bandung");
    expect(guessDestinationQuery("saya di Surabaya, kirim ke sana")).toBe("surabaya");
    expect(guessDestinationQuery("ongkir ke 40162")).toBe("40162");
    expect(guessDestinationQuery("halo kak")).toBe("");
  });
});
