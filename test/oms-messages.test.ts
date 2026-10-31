import { describe, expect, it } from "vitest";
import { orderFollowupText, orderSummaryText } from "@/lib/oms/messages";
import type { EventStatusOrder, Order } from "@/lib/oms/types";

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    nomor: "GRS-20261030-0012",
    order_group_id: "group-1",
    entitas: "FHI",
    status: "baru",
    metode_bayar: "cod",
    subtotal: 100000,
    diskon: 0,
    ongkir: 15000,
    total: 115000,
    nilai_cod: 115000,
    items: [],
    pengiriman: null,
    dibuat_at: "2026-10-30T02:15:00Z",
    terverifikasi_at: null,
    ...overrides,
  };
}

function event(data: Partial<EventStatusOrder["data"]> = {}): EventStatusOrder {
  return {
    event_id: "event-1",
    jenis: "order.status_changed",
    terjadi_at: "2026-10-31T06:20:00Z",
    data: {
      order_id: "order-1",
      nomor: "GRS-20261030-0012",
      order_group_id: "group-1",
      status_sebelum: "baru",
      status: "dikirim",
      ...data,
    },
  };
}

describe("orderSummaryText", () => {
  it("lists the order number, total, and COD", () => {
    const text = orderSummaryText([order()]);
    expect(text).toContain("GRS-20261030-0012");
    expect(text).toContain("115.000");
    expect(text).toContain("COD");
  });

  it("explains two packages for a mixed-entity checkout", () => {
    const text = orderSummaryText([
      order(),
      order({ id: "order-2", nomor: "GRS-20261030-0013", entitas: "SSR", total: 49500, nilai_cod: 49500 }),
    ]);
    expect(text).toContain("GRS-20261030-0012");
    expect(text).toContain("GRS-20261030-0013");
    expect(text).toContain("dua paket");
  });

  it("uses transfer wording instead of COD for transfer orders", () => {
    const text = orderSummaryText([order({ metode_bayar: "transfer", nilai_cod: 0 })]);
    expect(text).toContain("Transfer");
    expect(text).not.toContain("COD");
  });
});

describe("orderFollowupText", () => {
  it("mentions courier and receipt when the receipt is issued", () => {
    const text = orderFollowupText(event({ alasan: "resi_terbit", kurir: "JNE", resi: "JNE0123456789" }));
    expect(text).toContain("JNE");
    expect(text).toContain("JNE0123456789");
  });

  it("has a message for failed delivery, rejected COD, and RTS", () => {
    expect(orderFollowupText(event({ alasan: "gagal_antar" }))).toContain("belum berhasil");
    expect(orderFollowupText(event({ alasan: "cod_ditolak" }))).toContain("COD ditolak");
    expect(orderFollowupText(event({ status: "rts" }))).toContain("RTS");
  });

  it("thanks the buyer when the order is received", () => {
    expect(orderFollowupText(event({ status: "terkirim" }))).toContain("Terima kasih");
  });

  it("returns null for statuses without a customer message", () => {
    expect(orderFollowupText(event({ status: "di_gudang" }))).toBeNull();
  });
});
