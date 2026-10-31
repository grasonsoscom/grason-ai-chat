import { describe, expect, it } from "vitest";
import { detectOrderRequest, isOrderLookup, orderRequestReply } from "@/lib/oms/customer-intents";
import { codReminderText, orderFollowupText, orderLookupContext } from "@/lib/oms/messages";
import { hasRtRw, rtsRiskReasons } from "@/lib/oms/rts-risk";
import type { EventStatusOrder } from "@/lib/oms/types";

const fullAddress = {
  alamat: "Jl. Mawar No. 5 RT 01 RW 02",
  kecamatan: "Coblong",
  kode_pos: "40132",
};

describe("rtsRiskReasons", () => {
  it("passes a complete address, no RTS history and COD up to Rp 500.000", () => {
    expect(rtsRiskReasons({ alamat: fullAddress, totalCod: 500_000, previousRts: 0 })).toEqual([]);
  });

  it("lists every missing address part", () => {
    const reasons = rtsRiskReasons({ alamat: { alamat: "Jl. Mawar No. 5" }, totalCod: 100_000, previousRts: 0 });
    expect(reasons).toEqual(["alamat belum lengkap (RT/RW, kecamatan, kode pos)"]);
  });

  it("flags earlier RTS and large COD", () => {
    const reasons = rtsRiskReasons({ alamat: fullAddress, totalCod: 500_001, previousRts: 2 });
    expect(reasons).toEqual(["pelanggan pernah RTS (2x)", "nilai COD di atas Rp 500.000"]);
  });

  it.each(["RT 01 RW 02", "rt.3/rw.4", "RT01 RW05", "Gg. Melati 001/002"])("recognises RT/RW in %s", (a) => {
    expect(hasRtRw(a)).toBe(true);
  });

  it.each(["Jl. Mawar No. 5", "RT 01 saja", "Perum Griya Blok C"])("reports missing RT/RW in %s", (a) => {
    expect(hasRtRw(a)).toBe(false);
  });
});

describe("detectOrderRequest", () => {
  it.each([
    ["kak pesanan saya dibatalkan aja", "cancel"],
    ["cancel ya kak", "cancel"],
    ["gak jadi pesan deh", "cancel"],
    ["mau ganti alamat kak", "change_address"],
    ["alamatnya salah, harusnya blok D", "change_address"],
  ])("%s -> %s", (text, kind) => {
    expect(detectOrderRequest(text)).toBe(kind);
  });

  it.each(["jangan dibatalkan ya kak", "gak jadi masalah kok", "ok makasih", "alamat lengkapnya Jl. Mawar 5"])(
    "ignores %s",
    (text) => {
      expect(detectOrderRequest(text)).toBeNull();
    },
  );

  it("replies with the order number", () => {
    expect(orderRequestReply("cancel", "GRS-1")).toContain("pembatalan pesanan GRS-1");
    expect(orderRequestReply("change_address", "GRS-1")).toContain("RT/RW");
  });
});

describe("isOrderLookup", () => {
  it.each(["cek pesanan saya dong", "paket saya sudah sampai mana?", "resinya berapa kak", "kapan sampai ya", "status order saya"])(
    "detects %s",
    (text) => {
      expect(isOrderLookup(text)).toBe(true);
    },
  );

  it.each(["mau pesan 2 botol", "harganya berapa", "halo kak"])("ignores %s", (text) => {
    expect(isOrderLookup(text)).toBe(false);
  });
});

describe("COD messages", () => {
  const shipped: EventStatusOrder = {
    event_id: "e1",
    jenis: "order.status_changed",
    terjadi_at: "2026-10-31T01:00:00Z",
    data: { order_id: "o1", nomor: "GRS-1", order_group_id: "g1", status_sebelum: "di_gudang", status: "dikirim", kurir: "J&T", resi: "JT1" },
  };

  it("adds the cash to prepare to the shipped message for COD only", () => {
    expect(orderFollowupText(shipped, { metodeBayar: "cod", nilaiCod: 155_400 })).toMatch(/siapkan uang Rp\s?155\.400/);
    expect(orderFollowupText(shipped, { metodeBayar: "transfer", nilaiCod: 0 })).not.toContain("siapkan");
    expect(orderFollowupText(shipped)).not.toContain("siapkan");
  });

  it("builds the reminder with amount and resi", () => {
    const text = codReminderText("GRS-1", 155_400, "JT1");
    expect(text).toContain("GRS-1");
    expect(text).toContain("resi JT1");
    expect(text).toMatch(/Rp\s?155\.400/);
  });
});

describe("orderLookupContext", () => {
  it("lists only the given orders with status, payment and resi", () => {
    const ctx = orderLookupContext([
      {
        nomor: "GRS-2",
        status: "dikirim",
        metodeBayar: "cod",
        total: 155_400,
        nilaiCod: 155_400,
        pengirimanJson: JSON.stringify({ kurir: "J&T", resi: "JT2" }),
        createdAt: new Date("2026-10-31T01:00:00Z"),
      },
    ]);
    expect(ctx).toContain("GRS-2 (dibuat 2026-10-31): sudah dikirim");
    expect(ctx).toContain("resi JT2");
    expect(ctx).toContain("Jangan mengarang");
  });
});
