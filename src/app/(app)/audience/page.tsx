import { ActionButton, ActionForm, Modal, SubmitButton } from "@/components/forms";
import { EmptyState, Field, PageHeader, Table } from "@/components/ui";
import { db } from "@/lib/db";
import { createAudience, deleteAudience, importAudience } from "./actions";

export default async function AudiencePage() {
  const [audiences, customers] = await Promise.all([
    db.audience.findMany({ include: { _count: { select: { customers: true } } }, orderBy: { createdAt: "desc" } }),
    db.customer.findMany({ select: { id: true, name: true, phone: true }, orderBy: { name: "asc" } }),
  ]);
  const buttons = (
    <>
      <Modal trigger="+ Tambah Audiens" title="Tambah Audiens">
        <ActionForm action={createAudience}>
          <Field label="Nama audiens *"><input name="name" required className="input" /></Field>
          <p className="mb-1 text-sm font-medium text-slate-700">Pelanggan</p>
          <div className="mb-4 max-h-60 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {customers.length === 0 && <p className="text-sm text-slate-500">Belum ada pelanggan.</p>}
            {customers.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="customerIds" value={c.id} />{c.name} <span className="text-slate-400">{c.phone}</span></label>
            ))}
          </div>
          <SubmitButton>Simpan</SubmitButton>
        </ActionForm>
      </Modal>
      <Modal trigger="Impor" title="Impor Audiens" triggerClass="btn btn-secondary">
        <ActionForm action={importAudience}>
          <Field label="Nama audiens *"><input name="name" required className="input" /></Field>
          <Field label="File CSV *" hint="Kolom: nama, telepon, email. Unduh contoh untuk format yang benar.">
            <input name="file" type="file" accept=".csv,text/csv" required className="input" />
          </Field>
          <SubmitButton>Impor</SubmitButton>
        </ActionForm>
      </Modal>
      <a href="/api/audience/sample" className="btn btn-secondary" download>Unduh contoh</a>
    </>
  );

  return (
    <div>
      <PageHeader title="Audience" subtitle="Kelompok pelanggan untuk target broadcast" actions={buttons} />
      {audiences.length === 0 ? (
        <EmptyState title="Belum ada audiens" description="Buat audiens dari daftar pelanggan atau impor dari file CSV." action={<div className="flex flex-wrap justify-center gap-2">{buttons}</div>} />
      ) : (
        <Table head={["Nama", "Tipe", "Total Pelanggan", ""]}>
          {audiences.map((a) => (
            <tr key={a.id}>
              <td className="px-4 py-3 font-medium">{a.name}</td>
              <td className="px-4 py-3">{a.type}</td>
              <td className="px-4 py-3">{a._count.customers.toLocaleString("id-ID")}</td>
              <td className="px-4 py-3 text-right"><ActionButton action={deleteAudience} fields={{ id: a.id }} confirm={`Hapus audiens ${a.name}? Pelanggan tidak ikut terhapus.`}>🗑️</ActionButton></td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
