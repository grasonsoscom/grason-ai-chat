import Link from "next/link";
import type { ReactNode } from "react";
import { AiSettingsForm } from "@/components/ai-settings-form";
import { ActionButton, ActionForm, Modal, SubmitButton } from "@/components/forms";
import { RajaOngkirSettingsForm } from "@/components/rajaongkir-settings-form";
import { Badge, Field, PageHeader } from "@/components/ui";
import { getAiStatus } from "@/lib/ai-settings";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { getRajaOngkirStatus } from "@/lib/rajaongkir";
import { omsConfigured, omsHost } from "@/lib/oms/client";
import { importShipping, saveScalev, testOmsConnection } from "./actions";

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
  const [reg, cargo] = await Promise.all([
    db.shippingRate.groupBy({ by: ["city", "district"], where: { service: "REG" } }),
    db.shippingRate.groupBy({ by: ["city"], where: { service: "CARGO" } }),
  ]);
  const [ai, raja, user] = await Promise.all([getAiStatus(), getRajaOngkirStatus(), getCurrentUser()]);
  const isAdmin = user?.role.name === "Admin";
  const shipping = { reg: reg.length, cargo: cargo.length };
  const omsReady = omsConfigured();
  const omsBase = omsHost();
  const appUrl = process.env.APP_URL?.replace(/\/+$/, "");
  const omsWebhookUrl = `${appUrl || "https://<domain>"}/api/webhooks/oms`;
  const omsSecretReady = Boolean(process.env.OMS_WEBHOOK_SECRET);
  return (
    <div className="space-y-8">
      <PageHeader title="Integrasi" subtitle="Hubungkan GrasOn AI Chat dengan sistem dan platform lain" />

      <section>
        <h2 className="mb-3 font-semibold text-slate-700">Developer</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <IntegrationCard icon="📖" name="REST API & Developer"
            description="Dokumentasi API, personal access token, dan webhook keluar dengan tanda tangan HMAC."
            action={<Link href="/developer/api-docs" className="btn btn-secondary w-full">Buka Developer</Link>} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-semibold text-slate-700">AI / LLM</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <IntegrationCard icon="🤖" name="Model AI (LLM)"
            description={
              ai.configured
                ? `${ai.provider === "openai" ? "OpenAI-compatible" : "Anthropic Claude"} · ${ai.model || "model default"} · ${ai.source === "db" ? "disimpan di web" : "dari .env"}. Semua balasan AI Agent memakai model ini.`
                : "Pilih provider dan isi API key supaya AI Agent bisa membalas pelanggan. Bisa diatur dari web tanpa mengedit .env."
            }
            status={ai.configured ? <Badge tone="green">Aktif</Badge> : <Badge tone="amber">Belum dikonfigurasi</Badge>}
            action={
              <Modal trigger={isAdmin ? "Atur Model" : "Lihat Status"} title="Model AI (LLM)" triggerClass="btn btn-secondary w-full">
                <div className="mb-4 space-y-1 text-sm text-slate-600">
                  <p>Status: {ai.configured ? `aktif (${ai.source === "db" ? "pengaturan web" : ".env"})` : "belum aktif"}</p>
                  <p>Provider: <span className="font-medium">{ai.provider === "openai" ? "OpenAI-compatible" : "Anthropic Claude"}</span></p>
                  <p>Model: <code className="rounded bg-slate-100 px-1">{ai.model || "belum diisi"}</code></p>
                  {ai.provider === "openai" && <p>Base URL: <code className="rounded bg-slate-100 px-1 break-all">{ai.baseUrl || "belum diisi"}</code></p>}
                  <p>API key: {ai.hasDbKey ? "tersimpan di web" : ai.configured ? "dari .env" : "belum ada"}</p>
                </div>
                {isAdmin ? (
                  <AiSettingsForm
                    provider={ai.provider}
                    baseUrl={ai.baseUrl}
                    model={ai.model}
                    hasKey={ai.hasDbKey}
                    source={ai.configured ? ai.source : "none"}
                  />
                ) : (
                  <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">Hanya Admin yang dapat mengubah pengaturan model AI.</p>
                )}
              </Modal>
            } />
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-semibold text-slate-700">Ekspedisi</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <IntegrationCard icon="🚚" name="Ongkir J&T (Excel)"
            description={shipping.reg || shipping.cargo
              ? `${shipping.reg.toLocaleString("id-ID")} kecamatan J&T REG. AI Agent otomatis menjawab pertanyaan ongkir dari data ini.`
              : "Upload tabel ongkir J&T REG dan Cargo supaya AI Agent bisa menjawab pertanyaan ongkir otomatis."}
            status={shipping.reg || shipping.cargo ? <Badge tone="green">Aktif</Badge> : <Badge>Belum ada data</Badge>}
            action={
              <Modal trigger={shipping.reg || shipping.cargo ? "Perbarui Data" : "Upload Excel"} title="Ongkir J&T" triggerClass="btn btn-secondary w-full">
                {acc.shippingAt && (
                  <p className="mb-3 text-sm text-slate-600">Data saat ini: <span className="font-medium">{acc.shippingFile}</span>, diimpor {formatDateTime(acc.shippingAt)}.</p>
                )}
                <ActionForm action={importShipping}>
                  <Field label="File Excel (.xlsx)" hint='Sheet "J&T REG": Kab/Kota, Kecamatan, lalu tarif per gudang. Sheet "J&T CARGO": Kab/Kota, tarif per berat per gudang, dan SLA. Data lama akan diganti.'>
                    <input name="file" type="file" required accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="input" />
                  </Field>
                  <SubmitButton>Impor</SubmitButton>
                </ActionForm>
                <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">Untuk tiap tujuan, AI memakai tarif J&T REG (per paket) dari gudang yang paling murah. J&T Cargo tidak ditawarkan ke pelanggan.</p>
              </Modal>
            } />
          <IntegrationCard icon="🛵" name="Cek Ongkir RajaOngkir"
            description={raja.configured
              ? `${raja.courier.toUpperCase()} · asal ${raja.originLabel} · berat default ${raja.weight.toLocaleString("id-ID")} g. Cek tarif real-time ke seluruh Indonesia.`
              : "Cek ongkir real-time berbagai kurir berdasarkan kota asal, daerah tujuan, dan berat paket."}
            status={raja.configured ? <Badge tone="green">Aktif</Badge> : <Badge>Belum dikonfigurasi</Badge>}
            action={
              <Modal trigger={isAdmin ? "Atur RajaOngkir" : "Lihat Status"} title="RajaOngkir" triggerClass="btn btn-secondary w-full" wide>
                <div className="mb-4 space-y-1 text-sm text-slate-600">
                  <p>Status: {raja.configured ? `aktif (${raja.source === "db" ? "pengaturan web" : ".env"})` : "belum aktif"}</p>
                  <p>Kota asal: <span className="font-medium">{raja.originLabel || "belum dipilih"}</span></p>
                  <p>Kurir default: <code className="rounded bg-slate-100 px-1">{raja.courier}</code></p>
                  <p>Berat default: {raja.weight.toLocaleString("id-ID")} gram</p>
                  <p>API key: {raja.hasKey ? "tersimpan" : "belum ada"}</p>
                </div>
                {isAdmin ? (
                  <RajaOngkirSettingsForm
                    originId={raja.originId}
                    originLabel={raja.originLabel}
                    courier={raja.courier}
                    weight={raja.weight}
                    hasKey={raja.hasKey}
                  />
                ) : (
                  <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">Hanya Admin yang dapat mengubah pengaturan RajaOngkir.</p>
                )}
                {raja.configured && (
                  <Link href="/ongkir" className="btn btn-secondary mt-3 w-full">Buka Cek Ongkir</Link>
                )}
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
          <IntegrationCard icon="🏭" name="OMS GRASON"
            description="Lead, order, verifikasi, stok, dan harga lewat API OMS. Panduan ada di docs/oms/."
            status={omsReady ? <Badge tone="green">Aktif</Badge> : <Badge>Belum dikonfigurasi</Badge>}
            action={
              <Modal trigger="Status & tes" title="OMS GRASON" triggerClass="btn btn-secondary w-full" wide>
                <div className="space-y-3 text-sm text-slate-600">
                  <p>Base URL: <code className="rounded bg-slate-100 px-1">{omsBase ?? "belum diisi"}</code></p>
                  <p>Webhook: <code className="rounded bg-slate-100 px-1 break-all">{omsWebhookUrl}</code></p>
                  <p>Secret webhook: {omsSecretReady ? "sudah diisi" : "belum diisi"}</p>
                  {omsReady ? (
                    <ActionButton action={testOmsConnection} fields={{}} className="btn btn-secondary text-xs">
                      Tes koneksi
                    </ActionButton>
                  ) : (
                    <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-800">
                      Isi <code>OMS_BASE_URL</code>, <code>OMS_API_KEY</code>, dan <code>OMS_WEBHOOK_SECRET</code> di
                      environment, lalu restart server.
                    </p>
                  )}
                  <p className="border-t border-slate-100 pt-3 text-xs text-slate-500">
                    Integrasi wajib mengikuti docs/oms/INTEGRASI-OMS-GRASON.md dan docs/oms/cs-ai.v1.yaml.
                    Fase uji sambung memakai data dummy; jangan kirim nomor/alamat pelanggan asli.
                  </p>
                </div>
              </Modal>
            } />
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
