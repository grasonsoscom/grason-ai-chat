import { describe, expect, it } from "vitest";
import {
  addDays,
  buildDailyLeads,
  dueReportDay,
  leadReportText,
  longDay,
  parseRange,
  rupiah,
  wibDay,
  wibStart,
} from "@/lib/lead-report";

// 2026-11-18 08:30 WIB
const NOW = new Date("2026-11-18T01:30:00Z");
const at = (wib: string) => new Date(new Date(`${wib}:00Z`).getTime() - 7 * 3600_000);

describe("WIB days", () => {
  it("uses Asia/Jakarta calendar days", () => {
    expect(wibDay(new Date("2026-11-17T16:59:00Z"))).toBe("2026-11-17");
    expect(wibDay(new Date("2026-11-17T17:00:00Z"))).toBe("2026-11-18");
    expect(wibStart("2026-11-18").toISOString()).toBe("2026-11-17T17:00:00.000Z");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(longDay("2026-11-17")).toBe("Selasa, 17 Nov 2026");
    expect(rupiah(1268000)).toBe("Rp1.268.000");
  });
});

describe("parseRange", () => {
  it("falls back to the preset ending today", () => {
    expect(parseRange({}, NOW, [7, 30, 90], 30)).toEqual({ from: "2026-10-20", to: "2026-11-18", days: 30, custom: false });
    expect(parseRange({ d: "7" }, NOW, [7, 30, 90], 30).from).toBe("2026-11-12");
    expect(parseRange({ d: "5" }, NOW, [7, 30, 90], 30).days).toBe(30);
  });

  it("takes a custom range, swaps reversed dates and caps at today", () => {
    expect(parseRange({ dari: "2026-11-14", sampai: "2026-11-14" }, NOW, [7], 7)).toEqual({ from: "2026-11-14", to: "2026-11-14", days: 1, custom: true });
    expect(parseRange({ dari: "2026-11-16", sampai: "2026-11-10" }, NOW, [7], 7)).toMatchObject({ from: "2026-11-10", to: "2026-11-16", days: 7 });
    expect(parseRange({ dari: "2026-11-15", sampai: "2027-01-01" }, NOW, [7], 7)).toMatchObject({ to: "2026-11-18" });
    expect(parseRange({ dari: "2026-11-15" }, NOW, [7], 7)).toMatchObject({ from: "2026-11-15", to: "2026-11-18" });
  });

  it("ignores invalid dates and limits long ranges", () => {
    expect(parseRange({ dari: "2026-02-30", sampai: "x" }, NOW, [7], 7).custom).toBe(false);
    expect(parseRange({ dari: "undefined" }, NOW, [7], 7).custom).toBe(false);
    expect(parseRange({ dari: "2025-01-01", sampai: "2026-11-18" }, NOW, [7], 7).days).toBe(92);
  });
});

describe("buildDailyLeads", () => {
  const range = { from: "2026-11-16", to: "2026-11-17" };
  const firsts = [
    { conversationId: 1, at: at("2026-11-16T23:59"), source: "Organik", agent: "Ayu" },
    { conversationId: 2, at: at("2026-11-17T00:01"), source: "Iklan", agent: "Ayu" },
    { conversationId: 3, at: at("2026-11-17T10:00"), source: "Iklan", agent: "Tanpa agen AI" },
    { conversationId: 9, at: at("2026-11-15T10:00"), source: "Organik", agent: "Ayu" }, // before range
  ];
  const inbound = [
    { conversationId: 1, at: at("2026-11-16T23:59") },
    { conversationId: 1, at: at("2026-11-17T08:00") },
    { conversationId: 2, at: at("2026-11-17T00:01") },
    { conversationId: 2, at: at("2026-11-17T09:00") },
    { conversationId: 3, at: at("2026-11-17T10:00") },
    { conversationId: 9, at: at("2026-11-17T11:00") },
  ];
  const orders = [
    { conversationId: 2, at: at("2026-11-17T12:00"), total: 150000, status: "baru" },
    { conversationId: 9, at: at("2026-11-17T13:00"), total: 99000, status: "batal" },
  ];
  const r = buildDailyLeads(range, firsts, inbound, orders, new Set([2, 9]));

  it("counts new leads by their first WIB day and chats per day", () => {
    expect(r.rows.map((x) => x.day)).toEqual(["2026-11-17", "2026-11-16"]);
    expect(r.rows[0]).toEqual({ day: "2026-11-17", newLeads: 2, chats: 4, newBuyers: 1, orders: 2, revenue: 150000 });
    expect(r.rows[1]).toEqual({ day: "2026-11-16", newLeads: 1, chats: 1, newBuyers: 0, orders: 0, revenue: 0 });
  });

  it("totals count a returning chatter once", () => {
    expect(r.total).toMatchObject({ newLeads: 3, chats: 4, newBuyers: 1, orders: 2, revenue: 150000 });
  });

  it("splits new leads per source and agent", () => {
    expect(r.bySource).toEqual([
      { key: "Iklan", leads: 2, buyers: 1 },
      { key: "Organik", leads: 1, buyers: 0 },
    ]);
    expect(r.byAgent[0]).toEqual({ key: "Ayu", leads: 2, buyers: 1 });
  });

  it("writes a WhatsApp summary without customer data", () => {
    const text = leadReportText({ day: r.rows[0], prev: r.rows[1], week: r.rows, bySource: r.bySource, byAgent: r.byAgent, link: "https://x/laporan" });
    expect(text).toContain("*Lead masuk Selasa, 17 Nov 2026*");
    expect(text).toContain("Lead baru: *2* (naik 100% dari kemarin 1)");
    expect(text).toContain("Order: 2 · Omzet Rp150.000");
    expect(text).toContain("• Iklan: 2 (1 order)");
    expect(text).toContain("Detail: https://x/laporan");
  });
});

describe("dueReportDay", () => {
  const base = { enabled: true, hour: 7, lastDate: "2026-11-16", phones: ["62812"] };
  it("sends yesterday once the hour has passed", () => {
    expect(dueReportDay(base, NOW)).toBe("2026-11-17");
    expect(dueReportDay({ ...base, lastDate: "2026-11-17" }, NOW)).toBeNull();
    expect(dueReportDay({ ...base, hour: 9 }, NOW)).toBeNull();
  });
  it("does nothing when off or without numbers", () => {
    expect(dueReportDay({ ...base, enabled: false }, NOW)).toBeNull();
    expect(dueReportDay({ ...base, phones: [] }, NOW)).toBeNull();
  });
});
