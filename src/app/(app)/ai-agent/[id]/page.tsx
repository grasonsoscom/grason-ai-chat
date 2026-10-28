import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AiResponseTest } from "@/components/ai-test";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { Card, Field, Tabs } from "@/components/ui";
import { db } from "@/lib/db";
import { saveAgent, triggerFollowups } from "../actions";

const BEHAVIOR = [
  { key: "informasi", label: "Informasi" },
  { key: "kepribadian", label: "Kepribadian AI" },
  { key: "produk", label: "Produk" },
  { key: "pengaturan", label: "Pengaturan AI" },
  { key: "eskalasi", label: "Pengaturan Eskalasi" },
];

export default async function AgentDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; sub?: string }> }) {
  const id = Number((await params).id);
  const sp = await searchParams;
  const tab = sp.tab ?? "perilaku";
  const sub = sp.sub ?? "informasi";
  const [agent, account] = await Promise.all([
    db.aiAgent.findUnique({ where: { id }, include: { products: true, devices: true } }),
    db.account.findUnique({ where: { id: 1 } }),
  ]);
  if (!agent) notFound();
  const base = `/ai-agent/${id}`;

  const Section = ({ section, children }: { section: string; children: ReactNode }) => (
    <Card>
      <ActionForm action={saveAgent}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="section" value={section} />
        {children}
        <div className="mt-4 flex justify-end"><SubmitButton>Simpan Perubahan</SubmitButton></div>
      </ActionForm>
    </Card>
  );

  let body: ReactNode = null;
  if (tab === "perilaku") {
    if (sub === "informasi") body = (
      <Section section="informasi">
        <Field label="Nama agen *"><input name="name" required defaultValue={agent.name} className="input" /></Field>
        <Field label="Deskripsi" hint="Instruksi perilaku. Teks ini langsung memengaruhi balasan ke pelanggan. Uji dulu dengan AI Response Test sebelum disimpan.">
          <textarea name="description" rows={6} defaultValue={agent.description} className="input" />
        </Field>
        <Field label="Pembelajaran Dasar AI">
          <select name="baseLearning" defaultValue={agent.baseLearning} className="input">
            <option>Customer Service</option><option>Sales</option><option>Customer Support Teknis</option>
          </select>
        </Field>
      </Section>
    );
    else if (sub === "kepribadian") body = (
      <Section section="kepribadian">
        <Field label="Kepribadian AI" hint="Gaya bicara, sapaan, dan nada yang dipakai agen.">
          <textarea name="personality" rows={6} defaultValue={agent.personality} className="input" placeholder="Contoh: ramah, memanggil pelanggan dengan 'kak', pakai emoji secukupnya" />
        </Field>
      </Section>
    );
    else if (sub === "produk") {
      const products = await db.product.findMany({ select: { id: true, name: true } });
      body = (
        <Section section="produk">
          <p className="mb-3 text-sm text-slate-600">Produk yang boleh dijelaskan oleh agen ini.</p>
          {products.length === 0 && <p className="text-sm text-slate-500">Belum ada produk. <Link href="/produk" className="text-green-700 underline">Tambah produk</Link></p>}
          {products.map((p) => (
            <label key={p.id} className="mb-1 flex items-center gap-2 text-sm"><input type="checkbox" name="productIds" value={p.id} defaultChecked={agent.products.some((x) => x.id === p.id)} />{p.name}</label>
          ))}
        </Section>
      );
    } else if (sub === "pengaturan") body = (
      <Section section="pengaturan">
        <label className="mb-4 flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={agent.active} /> Agen aktif (membalas pesan otomatis)</label>
        <Field label="Panjang balasan maksimal (karakter)"><input name="maxReplyChars" type="number" min={50} max={4000} defaultValue={agent.maxReplyChars} className="input max-w-40" /></Field>
      </Section>
    );
    else if (sub === "eskalasi") body = (
      <Section section="eskalasi">
        <label className="mb-4 flex items-center gap-2 text-sm"><input type="checkbox" name="escalationEnabled" defaultChecked={agent.escalationEnabled} /> Aktifkan eskalasi berdasarkan kata kunci</label>
        <Field label="Kata kunci eskalasi" hint="Pisahkan dengan koma. Jika pesan pelanggan mengandung salah satunya, percakapan pindah ke tab Eskalasi dan AI berhenti membalas.">
          <input name="escalationKeywords" defaultValue={agent.escalationKeywords} className="input" placeholder="komplain, refund, bicara dengan admin" />
        </Field>
        <Field label="Pesan ke pelanggan saat eskalasi (opsional)">
          <textarea name="escalationMessage" rows={2} defaultValue={agent.escalationMessage} className="input" />
        </Field>
      </Section>
    );
  } else if (tab === "penugasan") {
    const devices = await db.device.findMany();
    body = (
      <Section section="penugasan">
        <p className="mb-3 text-sm text-slate-600">Nomor WhatsApp yang dibalas oleh agen ini.</p>
        {devices.map((d) => (
          <label key={d.id} className="mb-1 flex items-center gap-2 text-sm"><input type="checkbox" name="deviceIds" value={d.id} defaultChecked={agent.devices.some((x) => x.id === d.id)} />{d.label} ({d.phone})</label>
        ))}
      </Section>
    );
  } else if (tab === "funnels") {
    const funnels = await db.funnel.findMany();
    body = (
      <Section section="funnels">
        <Field label="Funnel yang dipakai agen" hint="Tahapan funnel dimasukkan ke konteks AI.">
          <select name="funnelId" defaultValue={agent.funnelId ?? ""} className="input">
            <option value="">Tidak ada</option>
            {funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Field>
      </Section>
    );
  } else if (tab === "followup") body = (
    <div className="space-y-4">
      <Section section="followup">
        <label className="mb-4 flex items-center gap-2 text-sm"><input type="checkbox" name="followupEnabled" defaultChecked={agent.followupEnabled} /> Aktifkan Auto-Followup</label>
        <Field label="Kirim follow-up setelah pelanggan tidak membalas selama (jam)" hint="1-23 jam, agar masih di dalam jendela 24 jam WhatsApp.">
          <input name="followupDelayHours" type="number" min={1} max={23} defaultValue={Math.min(agent.followupDelayHours, 23)} className="input max-w-32" />
        </Field>
        <Field label="Pesan follow-up"><textarea name="followupMessage" rows={3} defaultValue={agent.followupMessage} className="input" /></Field>
      </Section>
      <Card>
        <p className="mb-2 text-sm text-slate-600">Follow-up dijalankan berkala lewat <code className="rounded bg-slate-100 px-1">POST /api/cron/followup</code>, atau jalankan sekarang:</p>
        <ActionButton action={triggerFollowups} fields={{}} className="btn btn-secondary">Jalankan follow-up sekarang</ActionButton>
      </Card>
    </div>
  );
  else if (tab === "integrasi") body = (
    <Section section="integrasi">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="webhookOnReply" defaultChecked={agent.webhookOnReply} /> Kirim event <code className="rounded bg-slate-100 px-1">ai.replied</code> ke Outgoing Webhook setiap AI membalas</label>
      <p className="mt-2 text-xs text-slate-500">Atur URL webhook di menu <Link href="/integrasi" className="text-green-700 underline">Integrasi</Link>.</p>
    </Section>
  );

  return (
    <div className="max-w-4xl pb-20">
      <Link href="/ai-agent" className="text-sm text-slate-500 hover:text-slate-800">‹ Kembali ke AI Agent</Link>
      <div className="mb-4 mt-2 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{agent.name}</h1>
        <span className="text-sm text-slate-500">Sisa koin: <strong>{(account?.coins ?? 0).toLocaleString("id-ID")}</strong></span>
      </div>
      <Tabs active={tab} tabs={[
        { key: "perilaku", label: "Perilaku AI", href: base },
        { key: "penugasan", label: "Penugasan", href: `${base}?tab=penugasan` },
        { key: "funnels", label: "Funnels", href: `${base}?tab=funnels` },
        { key: "followup", label: "Auto-Followup", href: `${base}?tab=followup` },
        { key: "integrasi", label: "Integrasi", href: `${base}?tab=integrasi` },
      ]} />
      {tab === "perilaku" ? (
        <div className="grid gap-4 md:grid-cols-[200px_1fr]">
          <nav className="flex gap-1 overflow-x-auto md:flex-col">
            {BEHAVIOR.map((b) => (
              <Link key={b.key} href={`${base}?sub=${b.key}`} className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm ${sub === b.key ? "bg-green-50 font-medium text-green-700" : "text-slate-600 hover:bg-slate-100"}`}>{b.label}</Link>
            ))}
          </nav>
          <div>{body}</div>
        </div>
      ) : body}
      <AiResponseTest agentId={id} />
    </div>
  );
}
