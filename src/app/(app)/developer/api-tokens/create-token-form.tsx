"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";
import { SCOPES } from "@/lib/api/scopes";
import type { ActionState } from "@/lib/action";
import { createToken } from "./actions";

export function CreateTokenForm() {
  const [state, action] = useActionState<ActionState, FormData>(createToken, null);
  const [fullAccess, setFullAccess] = useState(false);
  const [copied, setCopied] = useState(false);
  const token = state?.ok;

  return (
    <form action={action}>
      <Field label="Nama token *" hint="Contoh: Zapier — order sync atau Website booking form.">
        <input name="name" required className="input" placeholder="My App Integration" />
      </Field>

      <label className="mb-3 flex items-center gap-2 text-sm">
        <input type="checkbox" name="fullAccess" checked={fullAccess} onChange={(event) => setFullAccess(event.target.checked)} />
        Full access (semua scope)
      </label>

      {!fullAccess && (
        <fieldset className="mb-3">
          <legend className="mb-2 text-sm font-medium text-slate-700">Scopes</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {SCOPES.map((scope) => (
              <label key={scope.key} className="flex items-start gap-2 rounded-md border border-slate-200 px-2 py-1.5 text-sm">
                <input type="checkbox" name="scopes" value={scope.key} className="mt-1" />
                <span>
                  <span className="block font-medium">{scope.key}</span>
                  <span className="block text-xs text-slate-500">{scope.label}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <Field label="Kedaluwarsa (opsional)" hint="Kosongkan untuk token yang tidak pernah kedaluwarsa.">
        <input type="date" name="expires_at" className="input" />
      </Field>

      {state?.error && (
        <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <SubmitButton>Buat API Token</SubmitButton>

      {token && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3">
          <p className="text-sm font-medium text-green-800">
            Token dibuat. Salin sekarang — token hanya ditampilkan sekali.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1.5 text-xs">{token}</code>
            <button
              type="button"
              className="btn btn-secondary text-xs"
              onClick={() => {
                navigator.clipboard.writeText(token).then(() => setCopied(true)).catch(() => {});
              }}
            >
              {copied ? "Tersalin" : "Salin"}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
