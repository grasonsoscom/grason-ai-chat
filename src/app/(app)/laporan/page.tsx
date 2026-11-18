import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Field, PageHeader, Table } from "@/components/ui";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatIDR } from "@/lib/format";
import {
  cityOf,
  conversion,
  groupReport,
  rtsRate,
  sourceKey,
  totalRow,
  type ReportChat,
  type ReportOrder,
  type Row,
} from "@/lib/reports";
import { addDays, dmy, longDay, parseRange, phonesOf, rupiah, wibDay, wibStart, type DayRow } from "@/lib/lead-report";
import { loadDailyLeads } from "@/lib/lead-report-data";
import { saveLeadReport, sendLeadReportNow } from "./actions";

const RANGES = [7, 30, 90];

function pct(value: number | null) {
  return value === null ? "-" : `${(value * 100).toFixed(1).replace(".", ",")}%`;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-800">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </Card>
  );
}

function ReportTable({ title, hint, rows, first }: { title: string; hint: string; rows: Row[]; first: string }) {
  return (
    <section className="mt-6">
      <h2 className="font-semibold text-slate-800">{title}</h2>
      <p className="mb-2 text-xs text-slate-500">{hint}</p>
      <Table head={[first, "Chat masuk", "Pembeli", "Konversi", "Order", "Omzet", "Terkirim", "RTS", "Rasio RTS"]} empty={!rows.length}>
        {rows.map((r) => (
          <tr key={r.key}>
            <td className="px-4 py-3 font-medium">{r.key}</td>
            <td className="px-4 py-3">{r.chats}</td>
            <td className="px-4 py-3">{r.buyers}</td>
            <td className="px-4 py-3">{pct(conversion(r))}</td>
            <td className="px-4 py-3">{r.orders}</td>
            <td className="px-4 py-3">{formatIDR(r.revenue)}</td>
            <td className="px-4 py-3">{r.delivered}</td>
            <td className="px-4 py-3">{r.rts}</td>
            <td className={`px-4 py-3 ${(rtsRate(r) ?? 0) >= 0.2 ? "font-semibold text-red-600" : ""}`}>{pct(rtsRate(r))}</td>
          </tr>
        ))}
      </Table>
    </section>
  );
}

function LeadTable({ rows, total }: { rows: DayRow[]; total: DayRow }) {
  const cells = (r: DayRow) => (
    <>
      <td className="px-4 py-3">{r.newLeads}</td>
      <td className="px-4 py-3">{r.chats}</td>
      <td className="px-4 py-3">{r.newBuyers}</td>
      <td className="px-4 py-3">{pct(r.newLeads ? r.newBuyers / r.newLeads : null)}</td>
      <td className="px-4 py-3">{r.orders}</td>
      <td className="px-4 py-3">{rupiah(r.revenue)}</td>
    </>
  );
  return (
    <Table head={["Tanggal", "Lead baru", "Chat masuk", "Lead baru yang order", "Konversi lead", "Order", "Omzet"]} empty={!rows.length}>
      {rows.map((r) => (
        <tr key={r.day}>
          <td className="px-4 py-3 font-medium">
            <Link href={`/laporan?dari=${r.day}&sampai=${r.day}`} className="hover:underline">{longDay(r.day)}</Link>
          </td>
          {cells(r)}
        </tr>
      ))}
      {rows.length > 1 && (
        <tr className="bg-slate-50 font-semibold">
          <td className="px-4 py-3">Total</td>
          {cells(total)}
        </tr>
      )}
    </Table>
  );
}

export default async function LaporanPage({ searchParams }: { searchParams: Promise<{ d?: string; dari?: string; sampai?: string }> }) {
  const user = await requirePageAccess("laporan");
  const isAdmin = user.role.name === "Admin";
  const params = await searchParams;
  const now = new Date();
  const range = parseRange(params, now, RANGES, 30);
  const days = range.days;
  const since = wibStart(range.from);
  const until = wibStart(addDays(range.to, 1));
  const today = wibDay(now);
  const yesterday = addDays(today, -1);
  const rangeLabel = range.from === range.to ? longDay(range.from) : `${dmy(range.from)} s/d ${dmy(range.to)}`;

  const [inbound, orderRows, agents, leads, acc] = await Promise.all([
    // A chat counts once per conversation with a customer message in range.
    db.message.findMany({
      where: { direction: "in", createdAt: { gte: since, lt: until } },
      distinct: ["conversationId"],
      select: { conversation: { select: { id: true, deviceId: true, omsKanal: true, omsCampaignId: true } } },
      take: 20_000,
    }),
    db.omsOrder.findMany({
      where: { createdAt: { gte: since, lt: until } },
      select: {
        conversationId: true,
        checkoutId: true,
        status: true,
        metodeBayar: true,
        total: true,
        checkout: { select: { createdByAi: true, payload: true } },
        conversation: { select: { deviceId: true, omsKanal: true, omsCampaignId: true } },
      },
      take: 20_000,
    }),
    db.aiAgent.findMany({ select: { name: true, devices: { select: { id: true } } } }),
    loadDailyLeads(range.from, range.to),
    db.account.findUnique({
      where: { id: 1 },
      select: { leadReportEnabled: true, leadReportPhones: true, leadReportHour: true, leadReportLastDate: true },
    }),
  ]);
  const reportPhones = phonesOf(acc?.leadReportPhones ?? "");
  const hourLabel = `${String(acc?.leadReportHour ?? 7).padStart(2, "0")}.00 WIB`;

  const agentByDevice = new Map<number, string>();
  for (const a of agents) for (const d of a.devices) agentByDevice.set(d.id, a.name);
  const agentOf = (deviceId: number | null) => (deviceId && agentByDevice.get(deviceId)) || "Tanpa agen AI";

  const chats: ReportChat[] = inbound.map((m) => ({
    conversationId: m.conversation.id,
    deviceId: m.conversation.deviceId,
    kanal: m.conversation.omsKanal,
    campaignId: m.conversation.omsCampaignId,
  }));
  const orders: ReportOrder[] = orderRows.map((o) => ({
    conversationId: o.conversationId,
    checkoutId: o.checkoutId,
    status: o.status,
    metodeBayar: o.metodeBayar,
    total: o.total,
    createdByAi: o.checkout.createdByAi,
    kota: cityOf(o.checkout.payload),
    deviceId: o.conversation.deviceId,
    kanal: o.conversation.omsKanal,
    campaignId: o.conversation.omsCampaignId,
  }));

  const total = totalRow(chats, orders);
  const aiOrders = orders.filter((o) => o.createdByAi).length;
  const byAgent = groupReport(chats, orders, (c) => agentOf(c.deviceId), (o) => agentOf(o.deviceId));
  const bySource = groupReport(chats, orders, sourceKey, sourceKey);
  // Cities have no chat count (the address is only known once an order exists).
  const byCity = groupReport([], orders, () => "", (o) => o.kota).filter((r) => r.delivered + r.rts > 0 || r.orders >= 2);

  return (
    <>
      <PageHeader
        title="Laporan"
        subtitle={`Lead, chat, dan order ${rangeLabel} (${days} hari). Rasio RTS dihitung dari order yang sudah selesai (terkirim atau RTS).`}
        actions={
          <div className="flex flex-wrap items-center gap-1">
            <Link href={`/laporan?dari=${today}&sampai=${today}`} className={`btn text-xs ${range.custom && range.from === today && range.to === today ? "btn-primary" : "btn-secondary"}`}>
              Hari ini
            </Link>
            <Link href={`/laporan?dari=${yesterday}&sampai=${yesterday}`} className={`btn text-xs ${range.custom && range.from === yesterday && range.to === yesterday ? "btn-primary" : "btn-secondary"}`}>
              Kemarin
            </Link>
            {RANGES.map((d) => (
              <Link key={d} href={`/laporan?d=${d}`} className={`btn text-xs ${!range.custom && d === days ? "btn-primary" : "btn-secondary"}`}>
                {d} hari
              </Link>
            ))}
            <form method="get" action="/laporan" className="flex flex-wrap items-center gap-1">
              <input type="date" name="dari" defaultValue={range.from} max={today} aria-label="Dari tanggal" className="input w-auto py-1 text-xs" />
              <span className="text-xs text-slate-500">s/d</span>
              <input type="date" name="sampai" defaultValue={range.to} max={today} aria-label="Sampai tanggal" className="input w-auto py-1 text-xs" />
              <button type="submit" className="btn btn-secondary text-xs">Terapkan</button>
            </form>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <Stat label="Lead baru" value={String(leads.total.newLeads)} hint={`${leads.total.newBuyers} sudah order`} />
        <Stat label="Chat masuk" value={String(total.chats)} hint="lead baru + pelanggan lama" />
        <Stat label="Konversi chat → order" value={pct(conversion(total))} hint={`${total.buyers} pembeli`} />
        <Stat label="Order" value={String(total.orders)} hint={`${aiOrders} dibuat AI`} />
        <Stat label="Omzet (tanpa batal)" value={formatIDR(total.revenue)} />
        <Stat label="Terkirim" value={String(total.delivered)} />
        <Stat label="Rasio RTS" value={pct(rtsRate(total))} hint={`${total.rts} RTS`} />
      </div>

      <section className="mt-6">
        <h2 className="font-semibold text-slate-800">Lead masuk harian</h2>
        <p className="mb-2 text-xs text-slate-500">
          Lead baru = nomor yang pertama kali chat di tanggal itu. Chat masuk = semua percakapan yang ada pesan pelanggan di tanggal itu (termasuk pelanggan lama). Klik tanggal untuk melihat laporan hari itu saja.
        </p>
        <LeadTable rows={leads.rows} total={leads.total} />
        {(leads.bySource.length > 0 || leads.byAgent.length > 0) && (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {[
              { title: "Lead baru per sumber", rows: leads.bySource },
              { title: "Lead baru per agen AI", rows: leads.byAgent },
            ].map((t) => (
              <Card key={t.title} className="p-4">
                <p className="mb-2 text-sm font-semibold text-slate-800">{t.title}</p>
                <ul className="space-y-1 text-sm">
                  {t.rows.map((r) => (
                    <li key={r.key} className="flex justify-between gap-3">
                      <span className="text-slate-600">{r.key}</span>
                      <span className="font-medium">
                        {r.leads} <span className="text-xs font-normal text-slate-400">({r.buyers} order)</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="mt-6">
        <Card className="p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-slate-800">Kirim laporan lead ke WhatsApp tiap pagi</h2>
            {acc?.leadReportEnabled ? <Badge tone="green">Aktif · {hourLabel}</Badge> : <Badge>Nonaktif</Badge>}
          </div>
          <p className="mb-3 text-xs text-slate-500">
            Setiap pagi sistem mengirim ringkasan lead kemarin (lead baru, chat masuk, order, omzet, per sumber dan per agen) dari nomor WhatsApp Hub yang terhubung.
            {acc?.leadReportLastDate ? ` Terakhir dikirim untuk ${longDay(acc.leadReportLastDate)}.` : ""}
          </p>
          {isAdmin ? (
            <div className="grid gap-4 md:grid-cols-2">
              <ActionForm action={saveLeadReport}>
                <Field label="Nomor WhatsApp tujuan" hint="Pisahkan dengan koma, maksimal 10 nomor. Format 0812… atau 62812…">
                  <textarea name="phones" rows={2} defaultValue={reportPhones.join(", ")} className="input" />
                </Field>
                <Field label="Jam kirim (WIB)">
                  <select name="hour" defaultValue={acc?.leadReportHour ?? 7} className="input">
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>{`${String(h).padStart(2, "0")}.00`}</option>
                    ))}
                  </select>
                </Field>
                <label className="mb-3 flex items-center gap-2 text-sm">
                  <input type="checkbox" name="enabled" defaultChecked={acc?.leadReportEnabled ?? false} /> Kirim otomatis setiap hari
                </label>
                <SubmitButton>Simpan</SubmitButton>
              </ActionForm>
              <ActionForm action={sendLeadReportNow}>
                <Field label="Kirim sekarang (tes)" hint="Kirim laporan tanggal yang dipilih ke nomor yang sudah disimpan.">
                  <input type="date" name="day" defaultValue={yesterday} max={today} className="input" />
                </Field>
                <SubmitButton variant="secondary">Kirim sekarang</SubmitButton>
              </ActionForm>
            </div>
          ) : (
            <p className="text-sm text-slate-600">
              {reportPhones.length ? `Dikirim ke ${reportPhones.length} nomor.` : "Belum ada nomor tujuan."} Hanya Admin yang dapat mengubah pengaturan ini.
            </p>
          )}
        </Card>
      </section>

      <ReportTable title="Per agen AI" hint="Berdasarkan perangkat WhatsApp yang menerima chat." rows={byAgent} first="Agen" />
      <ReportTable
        title="Per sumber"
        hint="Sumber dari atribusi lead OMS (kanal dan campaign iklan saat chat pertama). Pembelian ulang tetap tercatat ke sumber pertama."
        rows={bySource}
        first="Sumber"
      />
      <ReportTable
        title="Per kota"
        hint="Kota tujuan dari alamat order. Rasio RTS 20% ke atas ditandai merah. Kolom chat tidak tersedia per kota."
        rows={byCity}
        first="Kota"
      />
    </>
  );
}
