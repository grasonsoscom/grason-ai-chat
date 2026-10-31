"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { webhookEventGroups } from "@/lib/webhooks/events";
import { createWebhook } from "./actions";

export function CreateWebhookForm() {
  const [state, action] = useActionState<ActionState, FormData>(createWebhook, null);
  const [copied, setCopied] = useState(false);
  const secret = state?.ok;
  const groups = webhookEventGroups();

  return (
    <form action={action}>
      <Field label="Nama webhook *">
        <input name="name" required className="input" placeholder="CRM sync" />
      </Field>
      <Field label="Endpoint URL *" hint="Kami akan mengirim POST JSON bertanda tangan ke URL ini.">
        <input name="url" type="url" required className="input" placeholder="https://yourapp.com/webhook" />
      </Field>
      <Field label="Deskripsi (opsional)">
        <input name="description" className="input" placeholder="Sinkronisasi kontak ke CRM" />
      </Field>

      <fieldset className="mb-3">
        <legend className="mb-1 text-sm font-medium text-slate-700">Events</legend>
        <p className="mb-2 text-xs text-slate-500">
          Kosongkan semua untuk menerima setiap event. Event <code>test.ping</code> hanya dikirim lewat tombol Tes.
        </p>
        <div className="max-h-64 space-y-3 overflow-y-auto rounded-lg border border-slate-200 p-3">
          {groups.map((group) => (
            <div key={group.group}>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{group.group}</p>
              <div className="grid gap-1 sm:grid-cols-2">
                {group.events.map((event) => (
                  <label key={event.key} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name="events" value={event.key} className="mt-1" />
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
        <input type="checkbox" name="enabled" defaultChecked />
        Aktifkan endpoint
      </label>

      {state?.error && (
        <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <SubmitButton>Buat Endpoint</SubmitButton>

      {secret && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3">
          <p className="text-sm font-medium text-green-800">
            Webhook dibuat. Simpan secret sekarang — secret hanya ditampilkan sekali.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1.5 text-xs">{secret}</code>
            <button
              type="button"
              className="btn btn-secondary text-xs"
              onClick={() => {
                navigator.clipboard.writeText(secret).then(() => setCopied(true)).catch(() => {});
              }}
            >
              {copied ? "Tersalin" : "Salin"}
            </button>
          </div>
          <p className="mt-2 text-xs text-green-800">
            Verifikasi header <code>X-Webhook-Signature: t=&lt;unix&gt;,v1=&lt;hmac&gt;</code> dengan HMAC-SHA256
            dari <code>t + "." + raw body</code>.
          </p>
        </div>
      )}
    </form>
  );
}
