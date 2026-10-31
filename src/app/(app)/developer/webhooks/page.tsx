import { ActionButton, ActionForm, Modal, SubmitButton } from "@/components/forms";
import { AccessDenied, Badge, EmptyState, Field, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { webhookEventGroups } from "@/lib/webhooks/events";
import { migrateLegacyWebhook } from "@/lib/webhooks/migrate";
import { createWebhook, deleteWebhook, testWebhook, toggleWebhook, updateWebhook } from "./actions";
import { CreateWebhookForm } from "./create-webhook-form";

export default async function WebhooksPage() {
  const user = await requireUser();
  if (user.role.name !== "Admin") {
    return <AccessDenied message="Webhooks hanya dapat dikelola oleh Admin." />;
  }

  await migrateLegacyWebhook();

  const endpoints = await db.webhookEndpoint.findMany({
    include: { deliveries: { orderBy: { createdAt: "desc" }, take: 5 } },
    orderBy: { createdAt: "desc" },
  });
  const groups = webhookEventGroups();

  return (
    <div>
      <PageHeader
        title="Webhooks"
        subtitle="Kirim event GrasOn AI Chat ke aplikasi lain dengan tanda tangan HMAC."
        actions={
          <Modal trigger="Tambah Endpoint" title="New Webhook Endpoint" triggerClass="btn btn-primary" wide>
            <CreateWebhookForm />
          </Modal>
        }
      />

      <div className="mb-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
        <p>
          Setiap pengiriman menyertakan <code className="rounded bg-slate-100 px-1">X-Webhook-Event</code> dan{" "}
          <code className="rounded bg-slate-100 px-1">X-Webhook-Signature: t=&lt;unix&gt;,v1=&lt;hmac&gt;</code>.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          HMAC-SHA256 dari <code>t + "." + raw body</code> memakai secret endpoint. Secret hanya ditampilkan sekali
          saat endpoint dibuat.
        </p>
      </div>

      {endpoints.length === 0 ? (
        <EmptyState
          title="Belum ada webhook"
          description="Tambahkan endpoint HTTPS untuk menerima event kontak, pesan, campaign, dan AI."
          action={
            <Modal trigger="Tambah Endpoint" title="New Webhook Endpoint" wide>
              <CreateWebhookForm />
            </Modal>
          }
        />
      ) : (
        <div className="space-y-4">
          {endpoints.map((endpoint) => {
            const events = endpoint.events.split(",").filter(Boolean);
            return (
              <div key={endpoint.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{endpoint.name}</p>
                      {endpoint.enabled ? <Badge tone="green">Aktif</Badge> : <Badge>Nonaktif</Badge>}
                    </div>
                    <p className="mt-1 break-all text-xs text-slate-500">{endpoint.url}</p>
                    {endpoint.description && <p className="mt-1 text-sm text-slate-600">{endpoint.description}</p>}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {events.length === 0 ? (
                        <Badge tone="purple">Semua event</Badge>
                      ) : (
                        events.map((event) => <Badge key={event} tone="slate">{event}</Badge>)
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1">
                    <ActionButton
                      action={testWebhook}
                      fields={{ id: endpoint.id }}
                      className="btn btn-secondary text-xs"
                    >
                      Tes
                    </ActionButton>
                    <ActionButton
                      action={toggleWebhook}
                      fields={{ id: endpoint.id }}
                      className="btn btn-ghost text-xs"
                    >
                      {endpoint.enabled ? "Nonaktifkan" : "Aktifkan"}
                    </ActionButton>
                    <Modal trigger="Edit" title={`Edit ${endpoint.name}`} triggerClass="btn btn-ghost text-xs" wide>
                      <ActionForm action={updateWebhook}>
                        <input type="hidden" name="id" value={endpoint.id} />
                        <Field label="Nama webhook *">
                          <input name="name" required defaultValue={endpoint.name} className="input" />
                        </Field>
                        <Field label="Endpoint URL *">
                          <input name="url" type="url" required defaultValue={endpoint.url} className="input" />
                        </Field>
                        <Field label="Deskripsi (opsional)">
                          <input name="description" defaultValue={endpoint.description} className="input" />
                        </Field>
                        <fieldset className="mb-3">
                          <legend className="mb-1 text-sm font-medium text-slate-700">Events</legend>
                          <p className="mb-2 text-xs text-slate-500">Kosongkan semua untuk menerima setiap event.</p>
                          <div className="max-h-64 space-y-3 overflow-y-auto rounded-lg border border-slate-200 p-3">
                            {groups.map((group) => (
                              <div key={group.group}>
                                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{group.group}</p>
                                <div className="grid gap-1 sm:grid-cols-2">
                                  {group.events.map((event) => (
                                    <label key={event.key} className="flex items-start gap-2 text-sm">
                                      <input
                                        type="checkbox"
                                        name="events"
                                        value={event.key}
                                        defaultChecked={events.includes(event.key)}
                                        className="mt-1"
                                      />
                                      <span>
                                        <span className="block font-medium">{event.key}</span>
                                        <span className="block text-xs text-slate-500">{event.description}</span>
                                      </span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </fieldset>
                        <label className="mb-3 flex items-center gap-2 text-sm">
                          <input type="checkbox" name="enabled" defaultChecked={endpoint.enabled} />
                          Aktifkan endpoint
                        </label>
                        <SubmitButton>Simpan</SubmitButton>
                      </ActionForm>
                    </Modal>
                    <ActionButton
                      action={deleteWebhook}
                      fields={{ id: endpoint.id }}
                      confirm="Hapus webhook ini? Delivery log ikut terhapus."
                      className="btn btn-ghost text-xs text-red-600"
                    >
                      🗑️
                    </ActionButton>
                  </div>
                </div>

                <div className="mt-3 border-t border-slate-100 pt-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Recent deliveries</p>
                  {endpoint.deliveries.length === 0 ? (
                    <p className="text-sm text-slate-500">Belum ada pengiriman.</p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {endpoint.deliveries.map((delivery) => (
                        <li key={delivery.id} className="flex flex-wrap items-center gap-2">
                          <Badge tone={delivery.success ? "green" : "red"}>{delivery.success ? "OK" : "Gagal"}</Badge>
                          <span className="font-mono text-xs">{delivery.event}</span>
                          <span className="text-xs text-slate-500">HTTP {delivery.statusCode ?? "-"}</span>
                          <span className="text-xs text-slate-400">{delivery.durationMs} ms</span>
                          <span className="text-xs text-slate-400">{formatDateTime(delivery.createdAt)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
