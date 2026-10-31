import { beforeEach, describe, expect, it, vi } from "vitest";

// One conversation with one order; notes and messages are kept in memory.
type Order = { id: number; omsOrderId: string; nomor: string; status: string; metodeBayar: string; nilaiCod: number; total: number; checkoutId: number; conversationId: number; createdAt: Date };
let order: Order;
let payload: string;
const notes: string[] = [];
const sent: string[] = [];
let mode = "ai";

vi.mock("@/lib/db", () => ({
  db: {
    omsOrder: {
      findMany: async () => [order],
      findFirst: async ({ where }: { where: { status: { in: string[] } } }) => (where.status.in.includes(order.status) ? order : null),
    },
    omsCheckout: {
      findUnique: async () => ({ payload }),
      update: async ({ data }: { data: { payload: string } }) => {
        payload = data.payload;
        return {};
      },
    },
    message: {
      findFirst: async ({ where }: { where: { text: { startsWith: string } } }) => {
        const text = [...notes].reverse().find((n) => n.startsWith(where.text.startsWith));
        return text ? { text } : null;
      },
    },
    conversation: {
      update: async ({ data }: { data: { mode: string } }) => {
        mode = data.mode;
        return {};
      },
    },
  },
}));
vi.mock("@/lib/outbound", () => ({
  addSystemNote: async (_: number, text: string) => void notes.push(text),
  deliver: async (_: number, text: string) => {
    sent.push(text);
    return { status: "sent" };
  },
}));
vi.mock("@/lib/webhook", () => ({ emitWebhook: async () => {} }));
vi.mock("@/lib/oms/lead", () => ({ omsOnHandover: async () => {} }));

const cancelOrder = vi.fn(async (_id: string, _alasan: string) => ({ id: "o1", status: "batal" }));
const correctOrderAddress = vi.fn(async (_id: string, _input: unknown) => ({ id: "o1", status: "baru" }));
vi.mock("@/lib/oms/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/oms/client")>()),
  cancelOrder,
  correctOrderAddress,
}));
const applyOrderSnapshot = vi.fn(async () => ({ updated: true }));
vi.mock("@/lib/oms/orders", () => ({ applyOrderSnapshot }));

let extracted: Record<string, string> = {};
vi.mock("@/lib/ai", () => ({ generateText: async () => JSON.stringify(extracted) }));
vi.mock("@/lib/ai-order", () => ({ extractJson: (t: string) => JSON.parse(t) }));

const changes = await import("@/lib/oms/order-changes");
const { handleOrderChange, CANCEL_CONFIRM, ADDRESS_ASK, ADDRESS_CONFIRM } = changes;

const fullAddress = {
  alamat: "Jl. Kenanga 7 RT 02 RW 05",
  kelurahan: "Dago",
  kecamatan: "Coblong",
  kota: "Kota Bandung",
  provinsi: "Jawa Barat",
  kode_pos: "40135",
};

beforeEach(() => {
  order = { id: 1, omsOrderId: "o1", nomor: "GRS-20261031-0007", status: "baru", metodeBayar: "cod", nilaiCod: 155_400, total: 155_400, checkoutId: 3, conversationId: 7, createdAt: new Date() };
  payload = JSON.stringify({ alamat: { alamat: "Jl. Melati 2", kota: "Bandung", provinsi: "Jawa Barat" } });
  notes.length = 0;
  sent.length = 0;
  mode = "ai";
  extracted = {};
  cancelOrder.mockClear();
  correctOrderAddress.mockClear();
  applyOrderSnapshot.mockClear();
});

describe("helpers", () => {
  it("recognises confirmations", () => {
    expect(changes.isCancelConfirmation("BATAL")).toBe(true);
    expect(changes.isCancelConfirmation("ya batalkan kak")).toBe(true);
    expect(changes.isCancelConfirmation("ga jadi batal deh")).toBe(false);
    expect(changes.isYes("iya sudah benar")).toBe(true);
    expect(changes.isYes("bukan, salah")).toBe(false);
  });

  it("compares cities without Kota/Kabupaten prefixes", () => {
    expect(changes.normCity("KOTA BANDUNG")).toBe(changes.normCity("Bandung"));
    expect(changes.normCity("Kab. Bandung Barat")).not.toBe(changes.normCity("Bandung"));
  });

  it("lists missing address parts", () => {
    expect(changes.missingAddressParts(fullAddress)).toEqual([]);
    expect(changes.missingAddressParts({ alamat: "Jl. Kenanga 7", kota: "Bandung", provinsi: "Jawa Barat" })).toEqual([
      "RT/RW",
      "kecamatan",
      "kode pos",
    ]);
  });
});

describe("cancel over chat", () => {
  it("asks for confirmation first, then cancels in OMS", async () => {
    expect(await handleOrderChange(7, "kak pesanan saya dibatalkan aja", "")).toBe(true);
    expect(sent[0]).toContain(CANCEL_CONFIRM);
    expect(sent[0]).toContain(order.nomor);
    expect(cancelOrder).not.toHaveBeenCalled();

    expect(await handleOrderChange(7, "BATAL", sent[0])).toBe(true);
    expect(cancelOrder).toHaveBeenCalledWith("o1", expect.any(String));
    expect(applyOrderSnapshot).toHaveBeenCalledWith(1, { id: "o1", status: "batal" }, "chat");
  });

  it("does nothing when the buyer does not confirm", async () => {
    const prompt = `Kakak mau membatalkan pesanan ${order.nomor}? ${CANCEL_CONFIRM} ya.`;
    expect(await handleOrderChange(7, "eh ga jadi, lanjut aja", prompt)).toBe(false);
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it("sends orders already at the warehouse to staff", async () => {
    order.status = "di_gudang";
    expect(await handleOrderChange(7, "cancel ya kak", "")).toBe(true);
    expect(mode).toBe("eskalasi");
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it("escalates when OMS refuses", async () => {
    cancelOrder.mockRejectedValueOnce(new Error("409"));
    await handleOrderChange(7, "batal", `pesanan ${order.nomor}? ${CANCEL_CONFIRM}`);
    expect(mode).toBe("eskalasi");
    expect(sent.at(-1)).toContain("belum bisa dibatalkan otomatis");
  });
});

describe("address change over chat", () => {
  it("asks, shows the new address, and saves it after YA", async () => {
    await handleOrderChange(7, "mau ganti alamat kak", "");
    expect(sent[0]).toContain(ADDRESS_ASK);

    extracted = fullAddress;
    await handleOrderChange(7, "Jl. Kenanga 7 RT 02 RW 05, Dago, Coblong, Bandung 40135", sent[0]);
    expect(sent[1]).toContain(ADDRESS_CONFIRM);
    expect(sent[1]).toContain("Jl. Kenanga 7");
    expect(correctOrderAddress).not.toHaveBeenCalled();

    await handleOrderChange(7, "ya", sent[1]);
    expect(correctOrderAddress).toHaveBeenCalledWith("o1", { alamat: fullAddress });
    expect(JSON.parse(payload).alamat.alamat).toBe("Jl. Kenanga 7 RT 02 RW 05");
    expect(sent.at(-1)).toContain("sudah kami perbarui");
  });

  it("asks again for an incomplete address", async () => {
    extracted = { alamat: "Jl. Kenanga 7", kota: "Bandung", provinsi: "Jawa Barat" };
    await handleOrderChange(7, "Jl. Kenanga 7 Bandung", `alamat untuk pesanan ${order.nomor}: ${ADDRESS_ASK}`);
    expect(sent[0]).toContain("belum lengkap");
    expect(sent[0]).toContain(ADDRESS_ASK); // keeps the flow on the same step
    expect(correctOrderAddress).not.toHaveBeenCalled();
  });

  it("sends a move to another city to staff", async () => {
    extracted = { ...fullAddress, kota: "Kota Surabaya", provinsi: "Jawa Timur" };
    await handleOrderChange(7, "alamat baru di Surabaya …", `pesanan ${order.nomor}: ${ADDRESS_ASK}`);
    expect(mode).toBe("eskalasi");
    expect(sent[0]).toContain("beda kota");
    expect(correctOrderAddress).not.toHaveBeenCalled();
  });
});
