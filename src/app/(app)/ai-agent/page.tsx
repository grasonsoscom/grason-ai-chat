import Link from "next/link";
import { ActionButton } from "@/components/forms";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { createAgent, deleteAgent } from "./actions";

export default async function AiAgentListPage() {
  const agents = await db.aiAgent.findMany({ include: { devices: true, _count: { select: { products: true } } }, orderBy: { id: "asc" } });
  const addBtn = <form action={createAgent}><button className="btn btn-primary">+ Buat AI Agent</button></form>;
  return (
    <div>
      <PageHeader title="AI Agent" subtitle="Agen AI sebagai penjawab pertama sebelum eskalasi ke staf" actions={addBtn} />
      {agents.length === 0 ? <EmptyState title="Belum ada AI Agent" action={addBtn} /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {agents.map((a) => (
            <div key={a.id} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/ai-agent/${a.id}`} className="text-lg font-semibold hover:text-green-700">🤖 {a.name}</Link>
                <Badge tone={a.active ? "green" : "slate"}>{a.active ? "Aktif" : "Nonaktif"}</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-500">{a.baseLearning}</p>
              <p className="mt-2 line-clamp-2 text-sm text-slate-600">{a.description || "Belum ada deskripsi"}</p>
              <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                <span>{a.devices.length} perangkat · {a._count.products} produk</span>
                <span>
                  <Link href={`/ai-agent/${a.id}`} className="btn btn-ghost text-xs">Atur</Link>
                  <ActionButton action={deleteAgent} fields={{ id: a.id }} confirm={`Hapus AI Agent ${a.name}?`} className="btn btn-ghost text-xs text-red-600">Hapus</ActionButton>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
