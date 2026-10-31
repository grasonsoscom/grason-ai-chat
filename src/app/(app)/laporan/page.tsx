import Link from "next/link";
import { Card, PageHeader, Table } from "@/components/ui";
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

export default async function LaporanPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  await requirePageAccess("laporan");
  const days = RANGES.includes(Number((await searchParams).d)) ? Number((await searchParams).d) : 30;
  const since = new Date(Date.now() - days * 24 * 3600_000);

  const [inbound, orderRows, agents] = await Promise.all([
    // A chat counts once per conversation with a customer message in range.
    db.message.findMany({
      where: { direction: "in", createdAt: { gte: since } },
      distinct: ["conversationId"],
      select: { conversation: { select: { id: true, deviceId: true, omsKanal: true, omsCampaignId: true } } },
      take: 20_000,
    }),
    db.omsOrder.findMany({
      where: { createdAt: { gte: since } },
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
  ]);

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
        subtitle={`Chat dan order ${days} hari terakhir. Rasio RTS dihitung dari order yang sudah selesai (terkirim atau RTS).`}
        actions={
          <div className="flex gap-1">
            {RANGES.map((d) => (
              <Link key={d} href={`/laporan?d=${d}`} className={`btn text-xs ${d === days ? "btn-primary" : "btn-secondary"}`}>
                {d} hari
              </Link>
            ))}
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Chat masuk" value={String(total.chats)} />
        <Stat label="Konversi chat → order" value={pct(conversion(total))} hint={`${total.buyers} pembeli`} />
        <Stat label="Order" value={String(total.orders)} hint={`${aiOrders} dibuat AI`} />
        <Stat label="Omzet (tanpa batal)" value={formatIDR(total.revenue)} />
        <Stat label="Terkirim" value={String(total.delivered)} />
        <Stat label="Rasio RTS" value={pct(rtsRate(total))} hint={`${total.rts} RTS`} />
      </div>

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
