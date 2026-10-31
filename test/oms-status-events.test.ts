import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventStatusOrder, StatusOrder } from "@/lib/oms/types";

// In-memory stand-in for the two tables applyStatusEvent touches. updateMany
// implements the compare-and-set filter the real code relies on.
type Row = { id: number; nomor: string; conversationId: number; status: string; pengirimanJson: string | null; lastEventAt: Date | null };
const rows = new Map<number, Row>();

function matches(row: Row, where: Record<string, unknown>) {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.status !== undefined && row.status !== where.status) return false;
  const or = where.OR as { lastEventAt: null | { lt: Date } }[] | undefined;
  if (or) {
    return or.some((c) =>
      c.lastEventAt === null ? row.lastEventAt === null : row.lastEventAt !== null && row.lastEventAt < c.lastEventAt.lt,
    );
  }
  return true;
}

vi.mock("@/lib/db", () => ({
  db: {
    omsOrder: {
      findUniqueOrThrow: async ({ where }: { where: { id: number } }) => ({ ...rows.get(where.id)! }),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
        // Yield first so concurrent callers interleave like real DB round trips.
        await Promise.resolve();
        const row = rows.get(where.id as number);
        if (!row || !matches(row, where)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    conversation: {
      findUnique: async () => ({ mode: "ai", omsHandoverAt: null }),
      update: async () => ({}),
    },
  },
}));

const notes: string[] = [];
const sent: string[] = [];
vi.mock("@/lib/outbound", () => ({
  addSystemNote: async (_: number, text: string) => void notes.push(text),
  deliver: async () => ({ status: "sent" }),
  deliverAutomated: async (_: number, text: string) => {
    sent.push(text);
    return { status: "sent" };
  },
}));
vi.mock("@/lib/oms/queue", () => ({ enqueueOmsJob: vi.fn(async () => ({})) }));
vi.mock("@/lib/oms/client", () => ({}));

const { applyStatusEvent, isStatusRegression } = await import("@/lib/oms/orders");

function event(status: StatusOrder, at: string, extra: Partial<EventStatusOrder["data"]> = {}): EventStatusOrder {
  return {
    event_id: `${status}-${at}`,
    jenis: "order.status_changed",
    terjadi_at: at,
    data: { order_id: "o1", nomor: "GRS-1", order_group_id: "g1", status_sebelum: null, status, ...extra },
  };
}

beforeEach(() => {
  rows.clear();
  rows.set(1, { id: 1, nomor: "GRS-1", conversationId: 7, status: "terverifikasi", pengirimanJson: null, lastEventAt: null });
  notes.length = 0;
  sent.length = 0;
});

describe("isStatusRegression", () => {
  it("flags backwards moves only", () => {
    expect(isStatusRegression("dikirim", "terverifikasi")).toBe(true);
    expect(isStatusRegression("terverifikasi", "dikirim")).toBe(false);
    expect(isStatusRegression("dikirim", "rts")).toBe(false);
    expect(isStatusRegression("terkirim", "rts")).toBe(false);
  });
});

describe("applyStatusEvent", () => {
  it("applies a new status and notifies the customer once", async () => {
    const result = await applyStatusEvent(1, event("dikirim", "2026-10-31T01:00:00Z", { resi: "JT1" }));
    expect(result).toMatchObject({ updated: true, notified: true });
    expect(rows.get(1)!.status).toBe("dikirim");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("sudah dikirim");
  });

  it("notifies once when the same event is processed concurrently", async () => {
    const e = event("dikirim", "2026-10-31T01:00:00Z", { resi: "JT1" });
    await Promise.all([applyStatusEvent(1, e), applyStatusEvent(1, e)]);
    expect(sent).toHaveLength(1);
  });

  it("ignores an older event that arrives late", async () => {
    await applyStatusEvent(1, event("dikirim", "2026-10-31T02:00:00Z"));
    const late = await applyStatusEvent(1, event("di_gudang", "2026-10-31T01:00:00Z"));
    expect(late).toEqual({ ignored: true });
    expect(rows.get(1)!.status).toBe("dikirim");
    expect(sent).toHaveLength(1);
  });

  it("never regresses the status, even with a newer timestamp", async () => {
    await applyStatusEvent(1, event("dikirim", "2026-10-31T01:00:00Z"));
    expect(await applyStatusEvent(1, event("terverifikasi", "2026-10-31T02:00:00Z"))).toEqual({ ignored: true });
    expect(rows.get(1)!.status).toBe("dikirim");
  });

  it("notifies on a status found by polling, and a later webhook for it does not repeat the message", async () => {
    await applyStatusEvent(1, event("dikirim", new Date().toISOString(), { resi: "JT1" }), { source: "poll" });
    expect(notes.some((n) => n.includes("dari sinkronisasi OMS"))).toBe(true);
    await applyStatusEvent(1, event("dikirim", "2026-01-01T00:00:00Z", { resi: "JT1" }));
    expect(sent).toHaveLength(1);
  });

  it("still alerts on a late gagal_antar after polling moved the watermark", async () => {
    await applyStatusEvent(1, event("dikirim", new Date().toISOString()), { source: "poll" });
    sent.length = 0;
    const result = await applyStatusEvent(1, event("dikirim", "2026-01-01T00:00:00Z", { alasan: "gagal_antar" }));
    expect(result).toMatchObject({ notified: true });
    expect(sent[0]).toContain("belum berhasil mengantar");
    expect(notes.some((n) => n.includes("dieskalasi"))).toBe(true);
  });

  it("does not message the customer when nothing changed", async () => {
    await applyStatusEvent(1, event("dikirim", "2026-10-31T01:00:00Z", { resi: "JT1" }));
    sent.length = 0;
    const result = await applyStatusEvent(1, event("dikirim", "2026-10-31T02:00:00Z", { resi: "JT1" }));
    expect(result).toMatchObject({ notified: false });
    expect(sent).toHaveLength(0);
  });
});
