import Link from "next/link";
import type { ReactNode } from "react";
import { ActionButton } from "@/components/forms";
import { Badge, Card, PageHeader, Table } from "@/components/ui";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime, formatIDR, timeAgo } from "@/lib/format";
import { isAdminRole } from "@/lib/permissions";
import { retryOmsCheckout } from "../pesan/actions";
import { requeueOmsEvent, requeueOutboxJob } from "./actions";

const HOUR = 3600_000;

function chatLink(conversationId: number, label: ReactNode) {
  return (
    <Link href={`/pesan?c=${conversationId}`} className="text-green-700 hover:underline">
      {label}
    </Link>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "red" | "amber" | "slate" }) {
  const color = value === 0 ? "text-slate-400" : tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : "text-slate-800";
  return (
    <Card className="p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${color}`}>{value}</p>
    </Card>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="font-semibold text-slate-800">{title}</h2>
      <p className="mb-2 text-xs text-slate-500">{hint}</p>
      {children}
    </section>
  );
}

/** One place for order problems that otherwise hide in each chat's system notes. */
export default async function MonitorOrderPage() {
  const me = await requirePageAccess("pesan");
  const isAdmin = isAdminRole(me.role);
  const now = Date.now();

  const [failed, stuck, waiting, longShipping, events, jobs] = await Promise.all([
    db.omsCheckout.findMany({
      where: { status: "failed" },
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: { conversation: { include: { customer: true } } },
    }),
    db.omsCheckout.findMany({
      where: { status: "pending", createdAt: { lt: new Date(now - 15 * 60_000) } },
      orderBy: { createdAt: "asc" },
      take: 50,
      include: { conversation: { include: { customer: true } } },
    }),
    db.omsOrder.findMany({
      where: { status: "baru", createdAt: { lt: new Date(now - 30 * 60_000) } },
      orderBy: { createdAt: "asc" },
      take: 50,
      include: { conversation: { include: { customer: true } } },
    }),
    db.omsOrder.findMany({
      where: { status: "dikirim", metodeBayar: "cod", updatedAt: { lt: new Date(now - 5 * 24 * HOUR) } },
      orderBy: { updatedAt: "asc" },
      take: 50,
      include: { conversation: { include: { customer: true } } },
    }),
    db.omsWebhookEvent.findMany({
      where: { processedAt: null, lastError: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    db.omsOutbox.findMany({ where: { status: "failed" }, orderBy: { updatedAt: "desc" }, take: 30 }),
  ]);

  return (
    <>
      <PageHeader title="Monitor Order" subtitle="Order dan integrasi OMS yang perlu tindakan. Data diperbarui setiap kali halaman dibuka." />

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Checkout gagal" value={failed.length} tone="red" />
        <Stat label="Checkout tertahan >15 mnt" value={stuck.length} tone="amber" />
        <Stat label="Order belum diverifikasi >30 mnt" value={waiting.length} tone="amber" />
        <Stat label="COD dikirim >5 hari" value={longShipping.length} tone="amber" />
        <Stat label="Event OMS gagal" value={events.length} tone="red" />
        <Stat label="Antrean OMS gagal" value={jobs.length} tone="red" />
      </div>

      <Section title="Checkout gagal" hint='"Coba ulang" memakai ID pesanan yang sama, jadi aman dan tidak membuat order dobel.'>
        <Table head={["Pelanggan", "Dibuat", "Oleh", "Error", ""]} empty={!failed.length}>
          {failed.map((c) => (
            <tr key={c.id}>
              <td className="px-4 py-3">{chatLink(c.conversationId, c.conversation.customer.name)}</td>
              <td className="px-4 py-3 text-xs text-slate-500">{formatDateTime(c.createdAt)}</td>
              <td className="px-4 py-3">{c.createdByAi ? <Badge tone="purple">AI</Badge> : <Badge>Staf</Badge>}</td>
              <td className="px-4 py-3 text-xs text-red-700">{c.lastError ?? "-"}</td>
              <td className="px-4 py-3 text-right">
                <ActionButton action={retryOmsCheckout} fields={{ checkoutId: c.id }} className="btn btn-secondary text-xs">
                  Coba ulang
                </ActionButton>
              </td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Checkout tertahan" hint="Sudah lebih dari 15 menit belum mendapat nomor order dari OMS. Biasanya OMS sedang lambat; antrean mencoba ulang otomatis.">
        <Table head={["Pelanggan", "Dibuat", "Error terakhir"]} empty={!stuck.length}>
          {stuck.map((c) => (
            <tr key={c.id}>
              <td className="px-4 py-3">{chatLink(c.conversationId, c.conversation.customer.name)}</td>
              <td className="px-4 py-3 text-xs text-slate-500">{timeAgo(c.createdAt)}</td>
              <td className="px-4 py-3 text-xs text-slate-600">{c.lastError ?? "-"}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Order belum diverifikasi" hint="Status masih baru lebih dari 30 menit: konfirmasi alamat dan nilai COD ke pelanggan, lalu klik Verifikasi di chat. Termasuk order yang ditahan aturan risiko RTS.">
        <Table head={["Order", "Pelanggan", "Pembayaran", "Dibuat", "Catatan"]} empty={!waiting.length}>
          {waiting.map((o) => (
            <tr key={o.id}>
              <td className="px-4 py-3 font-medium">{o.nomor}</td>
              <td className="px-4 py-3">{chatLink(o.conversationId, o.conversation.customer.name)}</td>
              <td className="px-4 py-3">{o.metodeBayar === "cod" ? `COD ${formatIDR(o.nilaiCod)}` : `Transfer ${formatIDR(o.total)}`}</td>
              <td className="px-4 py-3 text-xs text-slate-500">{timeAgo(o.createdAt)}</td>
              <td className="px-4 py-3">
                {o.perluVerifikasiManusia && <Badge tone="red">Riwayat RTS (OMS)</Badge>}{" "}
                {o.conversation.mode === "eskalasi" && <Badge tone="amber">Eskalasi</Badge>}
              </td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="COD lama di perjalanan" hint="Dikirim lebih dari 5 hari dan belum diterima: risiko RTS. Hubungi pelanggan atau cek status kurir.">
        <Table head={["Order", "Pelanggan", "Nilai COD", "Status terakhir"]} empty={!longShipping.length}>
          {longShipping.map((o) => (
            <tr key={o.id}>
              <td className="px-4 py-3 font-medium">{o.nomor}</td>
              <td className="px-4 py-3">{chatLink(o.conversationId, o.conversation.customer.name)}</td>
              <td className="px-4 py-3">{formatIDR(o.nilaiCod)}</td>
              <td className="px-4 py-3 text-xs text-slate-500">dikirim · {timeAgo(o.updatedAt)}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Event OMS gagal diproses" hint="Status order dari OMS yang belum bisa diterapkan di CRM. Setelah 5 percobaan, event berhenti dicoba otomatis.">
        <Table head={["Diterima", "Percobaan", "Error", ""]} empty={!events.length}>
          {events.map((e) => (
            <tr key={e.id}>
              <td className="px-4 py-3 text-xs text-slate-500">{formatDateTime(e.createdAt)}</td>
              <td className="px-4 py-3">{e.attempts}</td>
              <td className="px-4 py-3 text-xs text-red-700">{e.lastError}</td>
              <td className="px-4 py-3 text-right">
                {isAdmin && (
                  <ActionButton action={requeueOmsEvent} fields={{ eventId: e.id }} className="btn btn-ghost text-xs">
                    Proses ulang
                  </ActionButton>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Antrean OMS gagal" hint="Pengiriman ke OMS (lead, order, verifikasi, pengingat COD) yang berhenti setelah beberapa percobaan.">
        <Table head={["Jenis", "Percobaan", "Terakhir", "Error", ""]} empty={!jobs.length}>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td className="px-4 py-3">
                <Badge>{j.kind}</Badge>
              </td>
              <td className="px-4 py-3">{j.attempts}</td>
              <td className="px-4 py-3 text-xs text-slate-500">{formatDateTime(j.updatedAt)}</td>
              <td className="px-4 py-3 text-xs text-red-700">{j.lastError ?? "-"}</td>
              <td className="px-4 py-3 text-right">
                {isAdmin && j.kind !== "create_order" && (
                  <ActionButton action={requeueOutboxJob} fields={{ jobId: j.id }} className="btn btn-ghost text-xs">
                    Coba ulang
                  </ActionButton>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Section>
    </>
  );
}
