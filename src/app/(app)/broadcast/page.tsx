import Link from "next/link";
import { ActionButton, ActionForm, Modal, SubmitButton } from "@/components/forms";
import { Badge, EmptyState, Field, PageHeader, Table } from "@/components/ui";
import { db } from "@/lib/db";
import { COIN_COSTS } from "@/lib/coins";
import { formatDateTime } from "@/lib/format";
import { createBroadcast, deleteBroadcast, sendBroadcast } from "./actions";

type Opts = { devices: { id: number; label: string; templates: { id: number; name: string }[] }[]; audiences: { id: number; name: string; _count: { customers: number } }[] };

function BroadcastForm({ type, devices, audiences }: Opts & { type: "Single" | "Series" }) {
  const templates = devices.flatMap((d) => d.templates.map((t) => ({ ...t, device: d.label })));
  if (!devices.length || !audiences.length || !templates.length) {
    return (
      <p className="text-sm text-slate-600">
        Broadcast membutuhkan perangkat dengan <Link href="/whatsapp" className="text-green-700 underline">template pesan</Link> dan minimal satu <Link href="/audience" className="text-green-700 underline">audiens</Link>.
      </p>
    );
  }
  return (
    <ActionForm action={createBroadcast}>
      <input type="hidden" name="type" value={type} />
      <Field label="Nama broadcast *"><input name="name" required className="input" /></Field>
      <Field label="Perangkat"><select name="deviceId" className="input">{devices.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select></Field>
      <Field label="Audiens"><select name="audienceId" className="input">{audiences.map((a) => <option key={a.id} value={a.id}>{a.name} ({a._count.customers})</option>)}</select></Field>
      <fieldset className="mb-4">
        <legend className="mb-1 text-sm font-medium text-slate-700">{type === "Single" ? "Template pesan" : "Template pesan (dikirim berurutan)"}</legend>
        <p className="mb-2 text-xs text-slate-500">Broadcast memakai template karena dikirim di luar jendela 24 jam.</p>
        {templates.map((t, i) => (
          <label key={t.id} className="flex items-center gap-2 text-sm">
            <input type={type === "Single" ? "radio" : "checkbox"} name="templateIds" value={t.id} defaultChecked={i === 0} required={type === "Single"} />
            {t.name} <span className="text-xs text-slate-400">({t.device})</span>
          </label>
        ))}
      </fieldset>
      <SubmitButton>Simpan Draft</SubmitButton>
    </ActionForm>
  );
}

export default async function BroadcastPage() {
  const [broadcasts, devices, audiences] = await Promise.all([
    db.broadcast.findMany({ include: { device: true, createdBy: true, audience: { include: { _count: { select: { customers: true } } } } }, orderBy: { updatedAt: "desc" } }),
    db.device.findMany({ select: { id: true, label: true, templates: { select: { id: true, name: true } } } }),
    db.audience.findMany({ select: { id: true, name: true, _count: { select: { customers: true } } } }),
  ]);
  const opts = { devices, audiences };
  const buttons = (
    <>
      <Modal trigger="Buat Broadcast Single" title="Buat Broadcast Single"><BroadcastForm type="Single" {...opts} /></Modal>
      <Modal trigger="Buat Broadcast Series" title="Buat Broadcast Series" triggerClass="btn btn-secondary"><BroadcastForm type="Series" {...opts} /></Modal>
    </>
  );
  const tone = { Draft: "slate", Terkirim: "green", Sebagian: "amber", Gagal: "red" } as const;

  return (
    <div>
      <PageHeader title="Broadcast" subtitle="Kirim pesan template ke banyak pelanggan sekaligus" actions={buttons} />
      {broadcasts.length === 0 ? (
        <EmptyState title="Belum ada broadcast" description="Buat broadcast pertama untuk menjangkau audiens Anda lewat WhatsApp." action={<div className="flex gap-2">{buttons}</div>} />
      ) : (
        <Table head={["Action", "Nama Broadcast", "Device", "Status", "Type", "Created By", "Date Updated"]}>
          {broadcasts.map((b) => {
            const recipients = b.audience?._count.customers ?? 0;
            const msgs = (JSON.parse(b.message) as number[]).length;
            const cost = recipients * msgs * COIN_COSTS.broadcastMessage;
            return (
              <tr key={b.id}>
                <td className="whitespace-nowrap px-4 py-3">
                  {b.status === "Draft" && (
                    <ActionButton action={sendBroadcast} fields={{ id: b.id }} className="btn btn-primary px-3 py-1 text-xs"
                      confirm={`Kirim ke ${recipients} pelanggan (${recipients * msgs} pesan${cost ? `, ${cost.toLocaleString("id-ID")} koin` : ""})?`}>Kirim</ActionButton>
                  )}
                  <ActionButton action={deleteBroadcast} fields={{ id: b.id }} confirm="Hapus broadcast ini?">🗑️</ActionButton>
                </td>
                <td className="px-4 py-3 font-medium">{b.name}</td>
                <td className="px-4 py-3">{b.device?.label ?? "-"}</td>
                <td className="px-4 py-3"><Badge tone={tone[b.status as keyof typeof tone] ?? "slate"}>{b.status}{b.sentCount ? ` (${b.sentCount})` : ""}</Badge></td>
                <td className="px-4 py-3">{b.type}</td>
                <td className="px-4 py-3">{b.createdBy?.name ?? "-"}</td>
                <td className="px-4 py-3 text-slate-500">{formatDateTime(b.updatedAt)}</td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}
