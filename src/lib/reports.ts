// Sales report aggregation (Laporan page). Pure functions over rows the page
// loads, so the numbers are testable without a database.

export type ReportChat = {
  conversationId: number;
  deviceId: number | null;
  kanal: string | null;
  campaignId: string | null;
};

export type ReportOrder = {
  conversationId: number;
  checkoutId: number;
  status: string;
  metodeBayar: string;
  total: number;
  createdByAi: boolean;
  kota: string;
  deviceId: number | null;
  kanal: string | null;
  campaignId: string | null;
};

export type Row = {
  key: string;
  chats: number;
  buyers: number;
  orders: number;
  revenue: number;
  delivered: number;
  rts: number;
};

/** Delivered + returned orders are the ones whose COD outcome is known. */
export function rtsRate(row: Pick<Row, "delivered" | "rts">) {
  const done = row.delivered + row.rts;
  return done ? row.rts / done : null;
}

export function conversion(row: Pick<Row, "chats" | "buyers">) {
  return row.chats ? row.buyers / row.chats : null;
}

function emptyRow(key: string): Row {
  return { key, chats: 0, buyers: 0, orders: 0, revenue: 0, delivered: 0, rts: 0 };
}

/**
 * Groups chats and orders by a key. "Buyers" counts conversations with at
 * least one order, so conversion = buyers / chats. Cancelled orders do not
 * count as revenue.
 */
export function groupReport(
  chats: ReportChat[],
  orders: ReportOrder[],
  keyOfChat: (c: ReportChat) => string,
  keyOfOrder: (o: ReportOrder) => string,
): Row[] {
  const rows = new Map<string, Row>();
  const row = (key: string) => rows.get(key) ?? rows.set(key, emptyRow(key)).get(key)!;
  for (const chat of chats) row(keyOfChat(chat)).chats++;

  const buyers = new Map<string, Set<number>>();
  for (const order of orders) {
    const key = keyOfOrder(order);
    const r = row(key);
    r.orders++;
    if (order.status !== "batal") r.revenue += order.total;
    if (order.status === "terkirim") r.delivered++;
    if (order.status === "rts") r.rts++;
    (buyers.get(key) ?? buyers.set(key, new Set()).get(key)!).add(order.conversationId);
  }
  for (const [key, set] of buyers) row(key).buyers = set.size;

  return [...rows.values()].sort((a, b) => b.revenue - a.revenue || b.chats - a.chats);
}

export function totalRow(chats: ReportChat[], orders: ReportOrder[]): Row {
  return groupReport(chats, orders, () => "Total", () => "Total")[0] ?? emptyRow("Total");
}

const KANAL_LABEL: Record<string, string> = {
  click_to_whatsapp: "Iklan klik-ke-WhatsApp",
  landing_page: "Landing page",
  organik: "Organik",
  lainnya: "Lainnya",
};

export function sourceKey(x: { kanal: string | null; campaignId: string | null }) {
  const kanal = x.kanal ? (KANAL_LABEL[x.kanal] ?? x.kanal) : "Tidak diketahui";
  return x.campaignId ? `${kanal} · campaign ${x.campaignId}` : kanal;
}

/** City from a stored checkout payload; "Tidak diketahui" when unreadable. */
export function cityOf(rawPayload: string) {
  try {
    const kota = (JSON.parse(rawPayload) as { alamat?: { kota?: string } }).alamat?.kota?.trim();
    return kota
      ? kota.toLowerCase().replace(/\s+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
      : "Tidak diketahui";
  } catch {
    return "Tidak diketahui";
  }
}
