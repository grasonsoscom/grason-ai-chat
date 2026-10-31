import { describe, expect, it } from "vitest";
import { cityOf, conversion, groupReport, rtsRate, sourceKey, totalRow, type ReportChat, type ReportOrder } from "@/lib/reports";

const chat = (id: number, kanal: string | null = "click_to_whatsapp", campaignId: string | null = "c1"): ReportChat => ({
  conversationId: id,
  deviceId: 1,
  kanal,
  campaignId,
});

const order = (conversationId: number, status: string, total: number, extra: Partial<ReportOrder> = {}): ReportOrder => ({
  conversationId,
  checkoutId: conversationId,
  status,
  metodeBayar: "cod",
  total,
  createdByAi: true,
  kota: "Bandung",
  deviceId: 1,
  kanal: "click_to_whatsapp",
  campaignId: "c1",
  ...extra,
});

describe("report aggregation", () => {
  const chats = [chat(1), chat(2), chat(3), chat(4, "organik", null)];
  const orders = [
    order(1, "terkirim", 100_000),
    order(1, "terkirim", 50_000), // second order, same buyer
    order(2, "rts", 120_000),
    order(3, "batal", 90_000),
    order(4, "dikirim", 80_000, { kanal: "organik", campaignId: null }),
  ];

  it("totals chats, buyers, revenue without cancelled orders, and RTS", () => {
    const t = totalRow(chats, orders);
    expect(t).toMatchObject({ chats: 4, buyers: 4, orders: 5, revenue: 350_000, delivered: 2, rts: 1 });
    expect(conversion(t)).toBe(1);
    expect(rtsRate(t)).toBeCloseTo(1 / 3);
  });

  it("groups by source and sorts by revenue", () => {
    const rows = groupReport(chats, orders, sourceKey, sourceKey);
    expect(rows.map((r) => r.key)).toEqual(["Iklan klik-ke-WhatsApp · campaign c1", "Organik"]);
    expect(rows[0]).toMatchObject({ chats: 3, buyers: 3, orders: 4, revenue: 270_000 });
    expect(rows[1]).toMatchObject({ chats: 1, buyers: 1, revenue: 80_000 });
  });

  it("has no RTS rate before any order finished", () => {
    expect(rtsRate({ delivered: 0, rts: 0 })).toBeNull();
    expect(conversion({ chats: 0, buyers: 0 })).toBeNull();
  });
});

describe("cityOf", () => {
  it("normalises the city name from the checkout payload", () => {
    expect(cityOf(JSON.stringify({ alamat: { kota: "KOTA  BANDUNG" } }))).toBe("Kota Bandung");
    expect(cityOf("{broken")).toBe("Tidak diketahui");
    expect(cityOf(JSON.stringify({ alamat: {} }))).toBe("Tidak diketahui");
  });
});
