// Loads the daily lead report from the database and sends the morning
// WhatsApp summary. Numbers come from lead-report.ts (pure, tested).
import { db } from "./db";
import { alertAdmin, cleanRecipients } from "./alerts";
import { sourceKey } from "./reports";
import {
  addDays,
  buildDailyLeads,
  dueReportDay,
  leadReportText,
  phonesOf,
  wibStart,
  type DailyLeads,
  type LeadFirst,
} from "./lead-report";

const ROW_LIMIT = 50_000;

/** Lead table for WIB days [from, to] (inclusive). */
export async function loadDailyLeads(from: string, to: string): Promise<DailyLeads> {
  const start = wibStart(from);
  const end = wibStart(addDays(to, 1));

  const [firstRows, inbound, orders, agents] = await Promise.all([
    // First-ever customer message per conversation, kept when it is in range.
    db.message.groupBy({
      by: ["conversationId"],
      where: { direction: "in" },
      _min: { createdAt: true },
      having: { createdAt: { _min: { gte: start, lt: end } } },
    }),
    db.message.findMany({
      where: { direction: "in", createdAt: { gte: start, lt: end } },
      select: { conversationId: true, createdAt: true },
      take: ROW_LIMIT,
    }),
    db.omsOrder.findMany({
      where: { createdAt: { gte: start, lt: end } },
      select: { conversationId: true, createdAt: true, total: true, status: true },
      take: ROW_LIMIT,
    }),
    db.aiAgent.findMany({ select: { name: true, devices: { select: { id: true } } } }),
  ]);

  const ids = firstRows.map((r) => r.conversationId);
  const [convs, buyers] = await Promise.all([
    db.conversation.findMany({
      where: { id: { in: ids } },
      select: { id: true, deviceId: true, omsKanal: true, omsCampaignId: true },
    }),
    db.omsOrder.findMany({ where: { conversationId: { in: ids } }, select: { conversationId: true }, distinct: ["conversationId"] }),
  ]);

  const agentByDevice = new Map<number, string>();
  for (const a of agents) for (const d of a.devices) agentByDevice.set(d.id, a.name);
  const convById = new Map(convs.map((c) => [c.id, c]));

  const firsts: LeadFirst[] = firstRows.map((r) => {
    const c = convById.get(r.conversationId);
    return {
      conversationId: r.conversationId,
      at: r._min.createdAt!,
      source: sourceKey({ kanal: c?.omsKanal ?? null, campaignId: c?.omsCampaignId ?? null }),
      agent: (c?.deviceId && agentByDevice.get(c.deviceId)) || "Tanpa agen AI",
    };
  });

  return buildDailyLeads(
    { from, to },
    firsts,
    inbound.map((m) => ({ conversationId: m.conversationId, at: m.createdAt })),
    orders.map((o) => ({ conversationId: o.conversationId, at: o.createdAt, total: o.total, status: o.status })),
    new Set(buyers.map((b) => b.conversationId)),
  );
}

/** WhatsApp text for one WIB day (compared with the day before and the last 7 days). */
export async function leadReportFor(day: string) {
  const week = await loadDailyLeads(addDays(day, -6), day);
  const dayOnly = await loadDailyLeads(day, day);
  const row = week.rows.find((r) => r.day === day)!;
  const prev = week.rows.find((r) => r.day === addDays(day, -1));
  const base = (process.env.APP_URL ?? "").replace(/\/+$/, "");
  return leadReportText({
    day: row,
    prev,
    week: week.rows,
    bySource: dayOnly.bySource,
    byAgent: dayOnly.byAgent,
    link: base ? `${base}/laporan?dari=${day}&sampai=${day}` : undefined,
  });
}

/** Sends the report for `day` to `phones` now. Returns how many numbers got it. */
export async function sendLeadReport(day: string, phones: string[]) {
  const to = cleanRecipients(phones);
  if (!to.length) return 0;
  const text = await leadReportFor(day);
  return alertAdmin(`lead-report:${day}`, text, 0, "📊 GrasOn AI Chat", to);
}

/**
 * Sends yesterday's report once the configured hour has passed. The day is
 * claimed with a compare-and-set on leadReportLastDate, so a restart or a
 * second process never sends it twice; a send that reached nobody is released
 * and tried again on the next check.
 */
export async function runLeadReportIfDue(now = new Date()) {
  const acc = await db.account.findUnique({
    where: { id: 1 },
    select: { leadReportEnabled: true, leadReportPhones: true, leadReportHour: true, leadReportLastDate: true },
  });
  if (!acc) return null;
  const phones = phonesOf(acc.leadReportPhones);
  const day = dueReportDay({ enabled: acc.leadReportEnabled, hour: acc.leadReportHour, lastDate: acc.leadReportLastDate, phones }, now);
  if (!day) return null;
  const claimed = await db.account.updateMany({
    where: { id: 1, leadReportLastDate: acc.leadReportLastDate },
    data: { leadReportLastDate: day },
  });
  if (!claimed.count) return null;
  let sent = 0;
  try {
    sent = await sendLeadReport(day, phones);
  } catch (e) {
    console.error("[lead-report] failed:", (e as Error).message);
  }
  if (!sent) {
    await db.account.updateMany({ where: { id: 1, leadReportLastDate: day }, data: { leadReportLastDate: acc.leadReportLastDate } });
    return null;
  }
  console.log(`[lead-report] ${day} sent to ${sent} number(s)`);
  return day;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Long-running servers (pm2): check every 10 minutes whether the report is due. */
export function startLeadReportScheduler(intervalMs = 10 * 60_000) {
  if (timer) return;
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    runLeadReportIfDue()
      .catch((e) => console.error("[lead-report] check failed:", (e as Error).message))
      .finally(() => {
        running = false;
      });
  };
  setTimeout(tick, 60_000).unref?.();
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
}
