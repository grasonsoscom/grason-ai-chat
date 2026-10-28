import Link from "next/link";
import type { FunnelLevel, FunnelStage } from "@prisma/client";
import { ActionButton, ActionForm, Modal, SubmitButton } from "@/components/forms";
import { Badge, EmptyState, Field, PageHeader, Tabs } from "@/components/ui";
import { db } from "@/lib/db";
import { addFunnel, addLabel, deleteFunnel, deleteLabel, deleteLevel, deleteStage, insertLevel, moveStage, saveStage } from "./actions";

export default async function FunnelsPage({ searchParams }: { searchParams: Promise<{ tab?: string; f?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab === "labels" ? "labels" : "funnels";
  return (
    <div>
      <PageHeader title="Funnels" subtitle="Alur kerja pelanggan dari Lead sampai pembelian" />
      <Tabs active={tab} tabs={[{ key: "funnels", label: "Funnels", href: "/funnels" }, { key: "labels", label: "Labels", href: "/funnels?tab=labels" }]} />
      {tab === "labels" ? <Labels /> : <Funnels selected={Number(sp.f) || null} />}
    </div>
  );
}

function StageForm({ stage, levelId, levels }: { stage?: FunnelStage; levelId: number; levels: FunnelLevel[] }) {
  return (
    <ActionForm action={saveStage}>
      {stage && <input type="hidden" name="id" value={stage.id} />}
      <Field label="Nama tahapan *"><input name="name" required defaultValue={stage?.name} className="input" /></Field>
      <Field label="Deskripsi" hint="Dipakai AI untuk mengenali kapan pelanggan berada di tahapan ini.">
        <textarea name="description" rows={3} defaultValue={stage?.description} className="input" />
      </Field>
      <Field label="Tingkat">
        <select name="levelId" defaultValue={stage?.levelId ?? levelId} className="input">
          {levels.map((l) => <option key={l.id} value={l.id}>Tingkat {l.order}</option>)}
        </select>
      </Field>
      <label className="mb-4 flex items-center gap-2 text-sm"><input type="checkbox" name="aiEnabled" defaultChecked={stage?.aiEnabled ?? true} /> Dijalankan oleh AI</label>
      <SubmitButton>Simpan</SubmitButton>
    </ActionForm>
  );
}

function InsertLevel({ funnelId, position }: { funnelId: number; position: number }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="h-px flex-1 bg-slate-200" />
      <ActionButton action={insertLevel} fields={{ funnelId, position }} className="rounded-full border border-dashed border-slate-300 bg-white px-3 py-0.5 text-xs text-slate-500 hover:border-green-500 hover:text-green-700">
        + Sisipkan tingkat
      </ActionButton>
      <div className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

async function Funnels({ selected }: { selected: number | null }) {
  const funnels = await db.funnel.findMany({ orderBy: { id: "asc" } });
  const addForm = (
    <Modal trigger="+ Buat Funnel" title="Buat Funnel">
      <ActionForm action={addFunnel}><Field label="Nama funnel"><input name="name" required className="input" /></Field><SubmitButton>Buat</SubmitButton></ActionForm>
    </Modal>
  );
  if (funnels.length === 0) return <EmptyState title="Belum ada funnel" action={addForm} />;
  const funnelId = selected && funnels.some((f) => f.id === selected) ? selected : funnels[0].id;
  const funnel = await db.funnel.findUniqueOrThrow({
    where: { id: funnelId },
    include: { levels: { orderBy: { order: "asc" }, include: { stages: { orderBy: { order: "asc" } } } } },
  });

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {funnels.map((f) => (
          <Link key={f.id} href={`/funnels?f=${f.id}`} className={`rounded-full px-3 py-1 text-sm ${f.id === funnelId ? "bg-green-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>{f.name}</Link>
        ))}
        {addForm}
        <ActionButton action={deleteFunnel} fields={{ id: funnelId }} confirm={`Hapus funnel ${funnel.name} beserta semua tahapannya?`} className="btn btn-ghost text-sm text-red-600">Hapus funnel ini</ActionButton>
      </div>

      <InsertLevel funnelId={funnelId} position={1} />
      {funnel.levels.map((level) => (
        <div key={level.id}>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">Tingkat {level.order}</p>
              {level.stages.length === 0 && <ActionButton action={deleteLevel} fields={{ id: level.id }} className="btn btn-ghost text-xs text-red-600">Hapus tingkat</ActionButton>}
            </div>
            <div className="flex flex-wrap gap-3">
              {level.stages.map((s, i) => (
                <div key={s.id} className="w-64 rounded-lg border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-100 text-xs font-semibold text-green-700">{s.number}</span>
                      <span className="font-medium">{s.name}</span>
                    </div>
                    {s.aiEnabled && <Badge tone="purple">AI</Badge>}
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-slate-500">{s.description}</p>
                  <div className="mt-2 flex justify-end gap-0.5">
                    {i > 0 && <ActionButton action={moveStage} fields={{ id: s.id, dir: "up" }}>←</ActionButton>}
                    {i < level.stages.length - 1 && <ActionButton action={moveStage} fields={{ id: s.id, dir: "down" }}>→</ActionButton>}
                    <Modal trigger="✏️" title="Edit Tahapan" triggerClass="btn btn-ghost text-sm"><StageForm stage={s} levelId={level.id} levels={funnel.levels} /></Modal>
                    <ActionButton action={deleteStage} fields={{ id: s.id }} confirm={`Hapus tahapan ${s.name}?`}>🗑️</ActionButton>
                  </div>
                </div>
              ))}
              <Modal trigger="+ Tambah Tahapan" title="Tambah Tahapan" triggerClass="flex w-64 min-h-24 items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-sm text-slate-500 hover:border-green-500 hover:text-green-700">
                <StageForm levelId={level.id} levels={funnel.levels} />
              </Modal>
            </div>
          </div>
          <InsertLevel funnelId={funnelId} position={level.order + 1} />
        </div>
      ))}
    </div>
  );
}

async function Labels() {
  const labels = await db.label.findMany({ include: { _count: { select: { customers: true } } }, orderBy: { name: "asc" } });
  return (
    <div className="max-w-xl space-y-4">
      <ActionForm action={addLabel} resetOnSuccess className="flex items-end gap-2">
        <div className="flex-1"><Field label="Label baru"><input name="name" required className="input" /></Field></div>
        <div className="mb-3"><input name="color" type="color" defaultValue="#22c55e" aria-label="Warna" className="h-10 w-12 rounded border border-slate-300" /></div>
        <div className="mb-3"><SubmitButton>Tambah</SubmitButton></div>
      </ActionForm>
      {labels.length === 0 ? <EmptyState title="Belum ada label" /> : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {labels.map((l) => (
            <li key={l.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: l.color }} />{l.name}<span className="text-slate-400">({l._count.customers} pelanggan)</span></span>
              <ActionButton action={deleteLabel} fields={{ id: l.id }} confirm={`Hapus label ${l.name}?`}>🗑️</ActionButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
