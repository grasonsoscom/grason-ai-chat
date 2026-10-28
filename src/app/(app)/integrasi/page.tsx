import type { ReactNode } from "react";
import { ActionButton, ActionForm, Modal, SubmitButton } from "@/components/forms";
import { Badge, Field, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { saveScalev, saveWebhook, testWebhook } from "./actions";

function IntegrationCard({ icon, name, description, status, action }: { icon: string; name: string; description: string; status?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-3xl" aria-hidden>{icon}</span>
        {status}
      </div>
      <p className="mt-3 font-semibold">{name}</p>
      <p className="mt-1 flex-1 text-sm text-slate-500">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const soon = <Badge tone="amber">COMING SOON</Badge>;

export default async function IntegrasiPage() {
  const acc = await db.account.findUniqueOrThrow({ where: { id: 1 } });
  return (
    <div className="space-y-8">
      <PageHeader title="Integrasi" subtitle="Hubungkan GrasOn AI Chat dengan sistem dan platform lain" />

      <section>
        <h2 className="mb-3 font-semibold text-slate-700">Outgoing Webhooks</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <IntegrationCard icon="🔗" name="Outgoing Webhooks" description="Kirim dan terima pesan dari sistem eksternal."
            status={acc.webhookEnabled ? <Badge tone="green">Aktif</Badge> : <Badge>Nonaktif</Badge>}
            action={
              <Modal trigger="Settings" title="Outgoing Webhooks" triggerClass="btn btn-secondary w-full" wide>
                <ActionForm action={saveWebhook}>
                  <Field label="URL tujuan" hint="GrasOn AI Chat mengirim POST JSON untuk event: message.received, message.sent, conversation.escalated, ai.replied.">
                    <input name="webhookUrl" type="url" defaultValue={acc.webhookUrl ?? ""} className="input" placeholder="https://sistem-anda.example/webhook" />
                  </Field>
                  <label className="mb-4 flex items-center gap-2 text-sm"><input type="checkbox" name="webhookEnabled" defaultChecked={acc.webhookEnabled} /> Aktifkan</label>
                  <SubmitButton>Simpan</SubmitButton>
                </ActionForm>
                <div className="mt-5 border-t border-slate-100 pt-4 text-sm text-slate-600">
                  <p className="mb-1 font-medium">Menerima pesan masuk</p>
                  <p>Kirim <code className="rounded bg-slate-100 px-1">POST /api/webhooks/incoming</code> dengan header <code className="rounded bg-slate-100 px-1">x-webhook-secret</code> (nilai <code>INCOMING_WEBHOOK_SECRET</code> di .env) dan body <code className="rounded bg-slate-100 px-1">{`{"phone","name","text"}`}</code>.</p>
                  <div className="mt-3"><ActionButton action={testWebhook} fields={{}} className="btn btn-secondary text-xs">Kirim event tes</ActionButton></div>
                </div>
              </Modal>
            } />
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-semibold text-slate-700">Messaging Platform</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <IntegrationCard icon="💭" name="Messenger" description="Balas pesan Facebook Messenger dari inbox GrasOn AI Chat." status={soon} />
          <IntegrationCard icon="🎵" name="TikTok" description="Kelola pesan TikTok di satu tempat." status={soon} />
          <IntegrationCard icon="📸" name="Instagram" description="Balas DM Instagram dengan AI Agent." status={soon} />
          <IntegrationCard icon="✈️" name="Telegram" description="Hubungkan bot Telegram ke GrasOn AI Chat." status={soon} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-semibold text-slate-700">Order Management Platform</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <IntegrationCard icon="🛒" name="Scalev" description="LP builder dan manajemen order."
            status={acc.scalevEnabled ? <Badge tone="green">Aktif</Badge> : <Badge>Nonaktif</Badge>}
            action={
              <Modal trigger="Settings" title="Scalev" triggerClass="btn btn-secondary w-full">
                <ActionForm action={saveScalev}>
                  <Field label="API key Scalev" hint={acc.scalevApiKey ? "Key sudah tersimpan. Kosongkan untuk tetap memakai key lama." : "Dapatkan dari dashboard Scalev."}>
                    <input name="scalevApiKey" type="password" autoComplete="off" className="input" />
                  </Field>
                  <label className="mb-4 flex items-center gap-2 text-sm"><input type="checkbox" name="scalevEnabled" defaultChecked={acc.scalevEnabled} /> Aktifkan</label>
                  <SubmitButton>Simpan</SubmitButton>
                </ActionForm>
              </Modal>
            } />
          <IntegrationCard icon="📝" name="AdForm" description="Form order dan landing page untuk e-commerce."
            action={
              <Modal trigger="Upgrade" title="AdForm" triggerClass="btn btn-primary w-full">
                <p className="text-sm text-slate-600">AdForm tersedia di paket yang lebih tinggi. Pilihan paket belum tersedia, hubungi tim GrasOn.</p>
              </Modal>
            } />
          <IntegrationCard icon="🌐" name="Berdu" description="Website dan landing page tanpa coding." status={soon} />
          <IntegrationCard icon="📦" name="Order Online" description="Order otomatis dari percakapan." status={soon} />
        </div>
      </section>
    </div>
  );
}
