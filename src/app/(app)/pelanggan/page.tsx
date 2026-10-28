import Link from "next/link";
import type { Customer, FunnelStage, Label } from "@prisma/client";
import { ActionButton, ActionForm, Modal, SubmitButton } from "@/components/forms";
import { Badge, EmptyState, Field, PageHeader, Table } from "@/components/ui";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { deleteCustomer, saveCustomer } from "./actions";

export default async function PelangganPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? "").trim();
  const [customers, labels, stages] = await Promise.all([
    db.customer.findMany({
      where: q ? { OR: [{ name: { contains: q } }, { phone: { contains: q } }, { email: { contains: q } }] } : {},
      include: { labels: true, stage: true, conversation: { select: { id: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.label.findMany(),
    db.funnelStage.findMany({ orderBy: { number: "asc" } }),
  ]);

  return (
    <div>
      <PageHeader title="Pelanggan" subtitle="Semua kontak yang pernah berinteraksi dengan bisnis Anda"
        actions={<Modal trigger="+ Tambah Pelanggan" title="Tambah Pelanggan"><CustomerForm labels={labels} stages={stages} /></Modal>} />
      <form className="mb-4 flex gap-2">
        <input name="q" defaultValue={q} placeholder="Cari nama, nomor, atau email" className="input max-w-sm" />
        <button className="btn btn-secondary">Cari</button>
      </form>
      {customers.length === 0 && !q ? (
        <EmptyState title="Belum ada pelanggan" description="Pelanggan otomatis tercatat saat mengirim pesan WhatsApp, atau tambahkan manual." />
      ) : (
        <Table head={["Nama", "Telepon", "Email", "Tahapan", "Label", "Dibuat", "Aksi"]} empty={customers.length === 0}>
          {customers.map((c) => (
            <tr key={c.id}>
              <td className="px-4 py-3 font-medium">{c.name}</td>
              <td className="px-4 py-3">{c.phone}</td>
              <td className="px-4 py-3">{c.email || "-"}</td>
              <td className="px-4 py-3">{c.stage ? `${c.stage.number}. ${c.stage.name}` : "-"}</td>
              <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{c.labels.map((l) => <Badge key={l.id}>{l.name}</Badge>)}</div></td>
              <td className="px-4 py-3 text-slate-500">{formatDate(c.createdAt)}</td>
              <td className="whitespace-nowrap px-4 py-3">
                {c.conversation && <Link href={`/pesan?c=${c.conversation.id}`} className="btn btn-ghost text-sm">💬</Link>}
                <Modal trigger="✏️" title="Edit Pelanggan" triggerClass="btn btn-ghost text-sm"><CustomerForm customer={c} labels={labels} stages={stages} /></Modal>
                <ActionButton action={deleteCustomer} fields={{ id: c.id }} confirm={`Hapus ${c.name}? Riwayat pesan juga akan terhapus.`}>🗑️</ActionButton>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function CustomerForm({ customer, labels, stages }: { customer?: Customer & { labels: Label[] }; labels: Label[]; stages: FunnelStage[] }) {
  const has = new Set(customer?.labels.map((l) => l.id));
  return (
    <ActionForm action={saveCustomer}>
      {customer && <input type="hidden" name="id" value={customer.id} />}
      <Field label="Nama *"><input name="name" required defaultValue={customer?.name} className="input" /></Field>
      <Field label="Nomor telepon *" hint="Format internasional, contoh +62..."><input name="phone" required defaultValue={customer?.phone} className="input" /></Field>
      <Field label="Email"><input name="email" type="email" defaultValue={customer?.email} className="input" /></Field>
      <Field label="Tahapan funnel">
        <select name="stageId" defaultValue={customer?.stageId ?? ""} className="input">
          <option value="">Tanpa tahapan</option>
          {stages.map((s) => <option key={s.id} value={s.id}>{s.number}. {s.name}</option>)}
        </select>
      </Field>
      {labels.length > 0 && (
        <fieldset className="mb-3">
          <legend className="mb-1 text-sm font-medium text-slate-700">Label</legend>
          <div className="flex flex-wrap gap-3">
            {labels.map((l) => (
              <label key={l.id} className="flex items-center gap-1 text-sm"><input type="checkbox" name="labelIds" value={l.id} defaultChecked={has.has(l.id)} />{l.name}</label>
            ))}
          </div>
        </fieldset>
      )}
      <Field label="Catatan"><textarea name="notes" rows={3} defaultValue={customer?.notes} className="input" /></Field>
      <SubmitButton>Simpan</SubmitButton>
    </ActionForm>
  );
}
