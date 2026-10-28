import { ActionButton, ActionForm, Modal, SubmitButton } from "@/components/forms";
import { Badge, Card, EmptyState, Field, PageHeader, Tabs } from "@/components/ui";
import { db } from "@/lib/db";
import { formatDateTime, timeAgo } from "@/lib/format";
import { HUB_API_TYPE } from "@/lib/whatsapp";
import { addDevice, addTemplate, assignStaff, deleteDevice, deleteTemplate, disconnectHub, saveCloudConfig, setDeviceStatus } from "./actions";
import { CallbackUrl } from "./cloud-setup";
import { HubPairing } from "./hub-pair";

function Check({ ok, label }: { ok: boolean; label: string }) {
  return <li className={ok ? "text-green-700" : "text-red-600"}>{ok ? "✓" : "✗"} {label}</li>;
}

/** Shows which Cloud API settings are present (values stay hidden) and the Meta setup steps. */
function CloudSetup() {
  const has = (k: string) => Boolean(process.env[k]?.trim());
  return (
    <details className="mb-5 rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <summary className="cursor-pointer font-medium">Pengaturan Webhook WhatsApp Cloud API</summary>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-1 font-medium text-slate-700">Status konfigurasi (.env)</p>
          <ul className="space-y-0.5">
            <Check ok={has("WHATSAPP_TOKEN")} label="WHATSAPP_TOKEN (kirim pesan)" />
            <Check ok={has("WHATSAPP_VERIFY_TOKEN")} label="WHATSAPP_VERIFY_TOKEN (verifikasi webhook)" />
            <Check ok={has("WHATSAPP_APP_SECRET")} label="WHATSAPP_APP_SECRET (tanda tangan webhook)" />
          </ul>
          <p className="mb-1 mt-3 font-medium text-slate-700">Callback URL</p>
          <CallbackUrl />
          <p className="mt-1 text-xs text-slate-500">Harus HTTPS dan bisa diakses dari internet. Untuk uji coba lokal, pakai tunnel seperti ngrok atau Cloudflare Tunnel.</p>
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-slate-600">
          <li>Di Meta App Dashboard, buka <strong>WhatsApp → Configuration</strong>.</li>
          <li>Isi <strong>Callback URL</strong> di samping dan <strong>Verify token</strong> sama dengan <code>WHATSAPP_VERIFY_TOKEN</code>, lalu <strong>Verify and save</strong>.</li>
          <li>Di <strong>Webhook fields</strong>, subscribe ke <code>messages</code>.</li>
          <li>Salin <strong>Phone number ID</strong> dari <strong>API Setup</strong> ke perangkat di bawah (tombol <strong>Cloud API</strong>).</li>
          <li>Tugaskan AI Agent ke perangkat di menu <strong>AI Agent → Penugasan</strong>.</li>
        </ol>
      </div>
    </details>
  );
}

type DeviceRow = Awaited<ReturnType<typeof loadDevices>>[number];
type StaffRow = { id: number; name: string };

function loadDevices() {
  return db.device.findMany({ include: { staff: true, templates: true, events: { orderBy: { createdAt: "desc" }, take: 30 } }, orderBy: { id: "asc" } });
}

export default async function WhatsAppPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab === "hub" ? "hub" : "business";
  const [all, staff] = await Promise.all([
    loadDevices(),
    db.user.findMany({ where: { status: "active" }, select: { id: true, name: true } }),
  ]);
  const devices = all.filter((d) => (d.apiType === HUB_API_TYPE) === (tab === "hub"));

  return (
    <div>
      <PageHeader title="WhatsApp Business" actions={tab === "business" ? (
        <Modal trigger="+ Tambah Perangkat" title="Tambah Perangkat">
          <ActionForm action={addDevice}>
            <Field label="Nama perangkat *"><input name="label" required className="input" placeholder="CS Toko" /></Field>
            <Field label="Nomor WhatsApp *"><input name="phone" required className="input" placeholder="+62..." /></Field>
            <Field label="Phone Number ID (Cloud API)" hint="Dari WhatsApp Manager > API Setup. Kosongkan jika memakai WHATSAPP_PHONE_NUMBER_ID di .env.">
              <input name="phoneNumberId" inputMode="numeric" className="input" />
            </Field>
            <label className="mb-4 flex items-center gap-2 text-sm"><input type="checkbox" name="coex" /> Coexistence (COEX), tetap bisa dipakai di aplikasi WhatsApp Business</label>
            <SubmitButton>Tambah</SubmitButton>
          </ActionForm>
        </Modal>
      ) : (
        <Modal trigger="+ Scan QR WhatsApp" title="Tautkan Nomor WhatsApp">
          <HubPairing />
        </Modal>
      )} />
      <Tabs active={tab} tabs={[
        { key: "business", label: "WhatsApp Business", href: "/whatsapp", badge: <Badge tone="green">RESMI</Badge> },
        { key: "hub", label: "WhatsApp Hub", href: "/whatsapp?tab=hub" },
      ]} />

      {tab === "hub" ? (
        <>
          <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            WhatsApp Hub menautkan nomor lewat scan QR seperti WhatsApp Web. Ini koneksi tidak resmi: tidak ada template Meta (template dikirim sebagai teks biasa) dan nomor bisa diblokir WhatsApp jika dipakai untuk pengiriman massal.
          </div>
          {devices.length === 0 ? (
            <EmptyState title="Belum ada nomor tertaut" description="Klik + Scan QR WhatsApp untuk menautkan nomor pertama Anda." />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {devices.map((d) => (
                <Card key={d.id}>
                  <DeviceHeader d={d} />
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                    <CommonActions d={d} staff={staff} />
                    {d.hubSessionKey ? (
                      <Modal trigger="Putuskan" title="Putuskan Perangkat" triggerClass="btn btn-secondary text-xs">
                        <p className="mb-4 text-sm">Nomor akan dilepas dari Perangkat tertaut di HP dan berhenti menerima pesan di GrasOn AI Chat.</p>
                        <ActionForm action={disconnectHub}>
                          <input type="hidden" name="deviceId" value={d.id} />
                          <SubmitButton variant="danger">Putuskan</SubmitButton>
                        </ActionForm>
                      </Modal>
                    ) : (
                      <Modal trigger="Scan Ulang" title="Tautkan Ulang Nomor" triggerClass="btn btn-primary text-xs">
                        <HubPairing defaultLabel={d.label} />
                      </Modal>
                    )}
                    <ActionButton action={deleteDevice} fields={{ id: d.id }} confirm={`Hapus perangkat ${d.label}?`} className="btn btn-ghost text-xs text-red-600">Hapus</ActionButton>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            Harga pengiriman pesan mengikuti tarif per volume Meta yang berlaku sejak 1 Januari 2026, dihitung sesuai zona waktu akun (Asia/Jakarta, UTC+07:00).
          </div>
          <CloudSetup />
          {devices.length === 0 ? (
            <EmptyState title="Belum ada perangkat" description="Hubungkan nomor WhatsApp Business pertama Anda." />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {devices.map((d) => (
                <Card key={d.id}>
                  <DeviceHeader d={d} />
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                    <CommonActions d={d} staff={staff} />
                    <Modal trigger="Cloud API" title="Pengaturan Cloud API" triggerClass="btn btn-secondary text-xs">
                      <ActionForm action={saveCloudConfig}>
                        <input type="hidden" name="deviceId" value={d.id} />
                        <Field label="Phone Number ID" hint="Dipakai untuk mengirim pesan dari nomor ini dan mencocokkan webhook pesan masuk.">
                          <input name="phoneNumberId" inputMode="numeric" defaultValue={d.phoneNumberId ?? ""} className="input" />
                        </Field>
                        <SubmitButton>Simpan</SubmitButton>
                      </ActionForm>
                    </Modal>
                    <Modal trigger="Status" title="Status Perangkat" triggerClass="btn btn-secondary text-xs">
                      <p className="mb-4 text-sm">Status saat ini: <strong>{d.status === "connected" ? "Terhubung" : "Terputus"}</strong></p>
                      <ActionForm action={setDeviceStatus}>
                        <input type="hidden" name="deviceId" value={d.id} />
                        <input type="hidden" name="status" value={d.status === "connected" ? "disconnected" : "connected"} />
                        <SubmitButton variant={d.status === "connected" ? "danger" : "primary"}>{d.status === "connected" ? "Putuskan" : "Hubungkan"}</SubmitButton>
                      </ActionForm>
                    </Modal>
                    <Modal trigger="Metode Pembayaran" title="Metode Pembayaran" triggerClass="btn btn-secondary text-xs">
                      <p className="text-sm text-slate-600">Metode pembayaran Meta dikelola melalui Meta Business Manager. Integrasi di GrasOn AI Chat belum tersedia.</p>
                    </Modal>
                    <ActionButton action={deleteDevice} fields={{ id: d.id }} confirm={`Hapus perangkat ${d.label}?`} className="btn btn-ghost text-xs text-red-600">Hapus</ActionButton>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DeviceHeader({ d }: { d: DeviceRow }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="font-semibold">{d.label}</p>
        <p className="text-sm text-slate-600">{d.phone}</p>
        <div className="mt-2 flex gap-1">
          <Badge tone="blue">{d.apiType}</Badge>{d.coex && <Badge tone="purple">COEX</Badge>}
          {d.apiType !== HUB_API_TYPE && (d.phoneNumberId ? <Badge tone="green">ID {d.phoneNumberId}</Badge> : <Badge tone="amber">Phone Number ID belum diisi</Badge>)}
        </div>
      </div>
      <div className="text-right text-sm">
        {d.status === "connected"
          ? <p className="text-green-700">● Terhubung pada {timeAgo(d.connectedAt)}</p>
          : <p className="text-red-600">● Terputus</p>}
        <p className="mt-1 text-xs text-slate-500">{d.staff.length} staf ditugaskan</p>
      </div>
    </div>
  );
}

function CommonActions({ d, staff }: { d: DeviceRow; staff: StaffRow[] }) {
  const hub = d.apiType === HUB_API_TYPE;
  return (
    <>
      <Modal trigger="Staf Penugasan" title="Staf Penugasan" triggerClass="btn btn-secondary text-xs">
        <ActionForm action={assignStaff}>
          <input type="hidden" name="deviceId" value={d.id} />
          <div className="mb-4 space-y-2">
            {staff.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="staffIds" value={s.id} defaultChecked={d.staff.some((x) => x.id === s.id)} /> {s.name}
              </label>
            ))}
          </div>
          <SubmitButton>Simpan</SubmitButton>
        </ActionForm>
      </Modal>
      <Modal trigger="Log Peristiwa" title="Log Peristiwa" triggerClass="btn btn-secondary text-xs">
        <ul className="max-h-80 space-y-2 overflow-y-auto text-sm">
          {d.events.map((e) => <li key={e.id} className="flex justify-between gap-3"><span>{e.message}</span><span className="shrink-0 text-xs text-slate-400">{formatDateTime(e.createdAt)}</span></li>)}
        </ul>
      </Modal>
      <Modal trigger="Atur Template Pesan" title="Template Pesan" triggerClass="btn btn-secondary text-xs" wide>
        <p className="mb-3 text-xs text-slate-500">
          {hub
            ? "Template dipakai untuk mengirim pesan di luar jendela 24 jam. Di WhatsApp Hub, isi template dikirim sebagai teks biasa."
            : "Template dipakai untuk mengirim pesan di luar jendela 24 jam. Template harus disetujui Meta dengan nama yang sama."}
        </p>
        <ul className="mb-4 divide-y divide-slate-100 text-sm">
          {d.templates.length === 0 && <li className="py-2 text-slate-500">Belum ada template.</li>}
          {d.templates.map((t) => (
            <li key={t.id} className="flex items-start justify-between gap-3 py-2">
              <div><p className="font-medium">{t.name} <Badge>{t.category}</Badge></p><p className="text-slate-600">{t.body}</p></div>
              <ActionButton action={deleteTemplate} fields={{ id: t.id }} confirm="Hapus template ini?">🗑️</ActionButton>
            </li>
          ))}
        </ul>
        <ActionForm action={addTemplate} resetOnSuccess>
          <input type="hidden" name="deviceId" value={d.id} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nama template"><input name="name" required className="input" placeholder="promo_bulanan" /></Field>
            <Field label="Kategori">
              <select name="category" className="input"><option>UTILITY</option><option>MARKETING</option><option>AUTHENTICATION</option></select>
            </Field>
          </div>
          <Field label="Isi"><textarea name="body" required rows={3} className="input" /></Field>
          <SubmitButton>Tambah Template</SubmitButton>
        </ActionForm>
      </Modal>
    </>
  );
}
