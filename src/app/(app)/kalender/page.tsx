import Link from "next/link";
import { ActionButton, ActionForm, Modal, SubmitButton } from "@/components/forms";
import { Field, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { formatTime } from "@/lib/format";
import { deleteEvent, saveEvent } from "./actions";

const DAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

export default async function KalenderPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const m = (await searchParams).m;
  const now = new Date();
  const [y, mo] = m && /^\d{4}-\d{2}$/.test(m) ? m.split("-").map(Number) : [now.getFullYear(), now.getMonth() + 1];
  const first = new Date(y, mo - 1, 1);
  const daysInMonth = new Date(y, mo, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

  const [events, staff, customers] = await Promise.all([
    db.calendarEvent.findMany({
      where: { date: { gte: first, lt: new Date(y, mo, 1) } },
      include: { staff: true, customer: true },
      orderBy: { date: "asc" },
    }),
    db.user.findMany({ select: { id: true, name: true } }),
    db.customer.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const monthName = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(first);

  return (
    <div>
      <PageHeader title="Kalender" subtitle="Jadwal follow-up dan janji temu dengan pelanggan"
        actions={
          <Modal trigger="+ Tambah Jadwal" title="Tambah Jadwal">
            <ActionForm action={saveEvent}>
              <Field label="Judul *"><input name="title" required className="input" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Tanggal *"><input name="date" type="date" required className="input" /></Field>
                <Field label="Jam"><input name="time" type="time" defaultValue="09:00" className="input" /></Field>
              </div>
              <Field label="Staf">
                <select name="staffId" className="input"><option value="">-</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              </Field>
              <Field label="Pelanggan">
                <select name="customerId" className="input"><option value="">-</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              </Field>
              <Field label="Catatan"><textarea name="notes" rows={2} className="input" /></Field>
              <SubmitButton>Simpan</SubmitButton>
            </ActionForm>
          </Modal>
        } />
      <div className="mb-3 flex items-center gap-3">
        <Link href={`/kalender?m=${fmt(new Date(y, mo - 2, 1))}`} className="btn btn-secondary">‹</Link>
        <span className="min-w-40 text-center font-medium capitalize">{monthName}</span>
        <Link href={`/kalender?m=${fmt(new Date(y, mo, 1))}`} className="btn btn-secondary">›</Link>
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-xl border border-slate-200 bg-white text-sm">
        {DAYS.map((d) => <div key={d} className="border-b border-slate-100 bg-slate-50 p-2 text-center text-xs font-medium text-slate-500">{d}</div>)}
        {Array.from({ length: offset }).map((_, i) => <div key={`e${i}`} className="min-h-24 border-b border-r border-slate-100" />)}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const dayEvents = events.filter((e) => e.date.getDate() === day);
          return (
            <div key={day} className="min-h-24 border-b border-r border-slate-100 p-1.5">
              <div className="mb-1 text-xs text-slate-500">{day}</div>
              {dayEvents.map((e) => (
                <div key={e.id} className="mb-1 flex items-start justify-between gap-1 rounded bg-green-50 px-1.5 py-1 text-xs text-green-800" title={e.notes}>
                  <span>{formatTime(e.date)} {e.title}{e.customer ? ` · ${e.customer.name}` : ""}</span>
                  <ActionButton action={deleteEvent} fields={{ id: e.id }} confirm="Hapus jadwal ini?" className="text-green-700 hover:text-red-600">×</ActionButton>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
