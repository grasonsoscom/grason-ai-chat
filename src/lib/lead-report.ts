// Daily lead report (Laporan page + morning WhatsApp summary). Pure functions
// over rows loaded by lead-report-data.ts, so the numbers are testable without
// a database. Days are calendar days in Asia/Jakarta (UTC+7, no DST).

const WIB_OFFSET_MS = 7 * 3600_000;
const DAY_MS = 24 * 3600_000;

/** Longest range the page loads at once. */
export const MAX_RANGE_DAYS = 92;

/** "YYYY-MM-DD" of a moment in Asia/Jakarta. */
export function wibDay(d: Date) {
  return new Date(d.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

/** Hour (0-23) of a moment in Asia/Jakarta. */
export function wibHour(d: Date) {
  return new Date(d.getTime() + WIB_OFFSET_MS).getUTCHours();
}

/** "YYYY-MM-DD" shifted by whole days. */
export function addDays(day: string, n: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Start of a WIB day as a UTC instant. */
export function wibStart(day: string) {
  return new Date(Date.parse(`${day}T00:00:00Z`) - WIB_OFFSET_MS);
}

function validDay(v: unknown) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v ? v : null;
}

export type DayRange = { from: string; to: string; days: number; custom: boolean };

/**
 * Range from the query string. `dari`/`sampai` (YYYY-MM-DD) win over the `d`
 * preset; invalid dates fall back to the preset. Never after today, at most
 * MAX_RANGE_DAYS, and swapped when given in the wrong order.
 */
export function parseRange(
  params: { d?: string; dari?: string; sampai?: string },
  now: Date,
  presets: number[],
  fallback: number,
): DayRange {
  const today = wibDay(now);
  let from = validDay(params.dari);
  let to = validDay(params.sampai);
  if (from || to) {
    from ??= to!;
    to ??= today;
    if (from > to) [from, to] = [to, from];
    if (to > today) to = today;
    if (from > to) from = to;
    if (dayCount(from, to) > MAX_RANGE_DAYS) from = addDays(to, -(MAX_RANGE_DAYS - 1));
    return { from, to, days: dayCount(from, to), custom: true };
  }
  const days = presets.includes(Number(params.d)) ? Number(params.d) : fallback;
  return { from: addDays(today, -(days - 1)), to: today, days, custom: false };
}

export function dayCount(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

export function daysBetween(from: string, to: string) {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export type LeadFirst = { conversationId: number; at: Date; source: string; agent: string };
export type LeadInbound = { conversationId: number; at: Date };
export type LeadOrder = { conversationId: number; at: Date; total: number; status: string };

export type DayRow = {
  day: string;
  /** Conversations whose first-ever customer message is on this day. */
  newLeads: number;
  /** Conversations with any customer message this day (new + returning). */
  chats: number;
  /** New leads of this day who have ordered (any time up to now). */
  newBuyers: number;
  orders: number;
  revenue: number;
};

export type Split = { key: string; leads: number; buyers: number };

export type DailyLeads = { rows: DayRow[]; total: DayRow; bySource: Split[]; byAgent: Split[] };

/**
 * Per-day table for [from, to]. `firsts` are first-ever inbound messages
 * (only those in range matter), `inbound` every inbound message in range,
 * `orders` orders in range plus `buyerIds` = conversations that ever ordered.
 * Cancelled orders do not count as revenue (same as the sales report).
 */
export function buildDailyLeads(
  range: { from: string; to: string },
  firsts: LeadFirst[],
  inbound: LeadInbound[],
  orders: LeadOrder[],
  buyerIds: Set<number>,
): DailyLeads {
  const rows = new Map<string, DayRow>();
  for (const day of daysBetween(range.from, range.to).reverse()) {
    rows.set(day, { day, newLeads: 0, chats: 0, newBuyers: 0, orders: 0, revenue: 0 });
  }
  const inRange = (d: Date) => rows.get(wibDay(d));

  const src = new Map<string, Split>();
  const agt = new Map<string, Split>();
  const bump = (m: Map<string, Split>, key: string, buyer: boolean) => {
    const s = m.get(key) ?? m.set(key, { key, leads: 0, buyers: 0 }).get(key)!;
    s.leads++;
    if (buyer) s.buyers++;
  };
  for (const f of firsts) {
    const row = inRange(f.at);
    if (!row) continue;
    const buyer = buyerIds.has(f.conversationId);
    row.newLeads++;
    if (buyer) row.newBuyers++;
    bump(src, f.source, buyer);
    bump(agt, f.agent, buyer);
  }

  const seen = new Set<string>();
  for (const m of inbound) {
    const day = wibDay(m.at);
    const key = `${day}:${m.conversationId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = rows.get(day);
    if (row) row.chats++;
  }

  for (const o of orders) {
    const row = inRange(o.at);
    if (!row) continue;
    row.orders++;
    if (o.status !== "batal") row.revenue += o.total;
  }

  const list = [...rows.values()];
  const total: DayRow = { day: "Total", newLeads: 0, chats: 0, newBuyers: 0, orders: 0, revenue: 0 };
  for (const r of list) {
    total.newLeads += r.newLeads;
    total.newBuyers += r.newBuyers;
    total.orders += r.orders;
    total.revenue += r.revenue;
  }
  // A returning customer chatting on several days counts once in the total.
  total.chats = new Set(inbound.filter((m) => rows.has(wibDay(m.at))).map((m) => m.conversationId)).size;

  const sort = (m: Map<string, Split>) => [...m.values()].sort((a, b) => b.leads - a.leads || a.key.localeCompare(b.key));
  return { rows: list, total, bySource: sort(src), byAgent: sort(agt) };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const WEEKDAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

/** "Selasa, 17 Nov 2026" */
export function longDay(day: string) {
  const d = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "17-11-2026" */
export function dmy(day: string) {
  const [y, m, d] = day.split("-");
  return `${d}-${m}-${y}`;
}

export function rupiah(n: number) {
  return `Rp${Math.round(n).toLocaleString("id-ID").replace(/,/g, ".")}`;
}

function change(now: number, before: number) {
  if (now === before) return `sama dengan kemarin`;
  if (!before) return `kemarin 0`;
  const p = Math.round(((now - before) / before) * 100);
  return `${p > 0 ? `naik ${p}%` : `turun ${-p}%`} dari kemarin ${before}`;
}

/**
 * WhatsApp text for one day: `day` is the report day, `prev` the day before,
 * `week` the 7 days ending on `day` (for the average). No customer data, only
 * counts per source and agent.
 */
export function leadReportText(input: { day: DayRow; prev?: DayRow; week: DayRow[]; bySource: Split[]; byAgent: Split[]; link?: string }) {
  const { day, prev, week, bySource, byAgent, link } = input;
  const avg = week.length ? week.reduce((s, r) => s + r.newLeads, 0) / week.length : 0;
  const lines = [
    `*Lead masuk ${longDay(day.day)}*`,
    "",
    `👤 Lead baru: *${day.newLeads}*${prev ? ` (${change(day.newLeads, prev.newLeads)})` : ""}`,
    `💬 Chat masuk: ${day.chats} (lead baru + pelanggan lama)`,
    `🛒 Order: ${day.orders} · Omzet ${rupiah(day.revenue)}`,
    `✅ Lead baru yang sudah order: ${day.newBuyers}${day.newLeads ? ` (${Math.round((day.newBuyers / day.newLeads) * 100)}%)` : ""}`,
  ];
  if (week.length > 1) lines.push(`📈 Rata-rata 7 hari: ${avg.toFixed(1).replace(".", ",")} lead/hari`);
  const list = (title: string, rows: Split[]) => {
    if (!rows.length) return;
    lines.push("", `*${title}*`);
    for (const r of rows.slice(0, 6)) lines.push(`• ${r.key}: ${r.leads}${r.buyers ? ` (${r.buyers} order)` : ""}`);
    if (rows.length > 6) lines.push(`• lainnya: ${rows.slice(6).reduce((s, r) => s + r.leads, 0)}`);
  };
  list("Per sumber", bySource);
  list("Per agen", byAgent);
  if (link) lines.push("", `Detail: ${link}`);
  return lines.join("\n");
}

/**
 * The WIB day to report now, or null. Sends yesterday's report once the
 * configured hour has passed and it has not been sent yet.
 */
export function dueReportDay(settings: { enabled: boolean; hour: number; lastDate: string; phones: string[] }, now: Date) {
  if (!settings.enabled || !settings.phones.length) return null;
  if (wibHour(now) < settings.hour) return null;
  const day = addDays(wibDay(now), -1);
  return settings.lastDate >= day ? null : day;
}

/** Stored comma list → numbers. */
export function phonesOf(stored: string) {
  return stored.split(",").map((s) => s.trim()).filter(Boolean);
}

export function clampHour(v: number) {
  return Number.isInteger(v) && v >= 0 && v <= 23 ? v : 7;
}
