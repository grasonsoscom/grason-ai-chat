"use client";

import { createContext, useActionState, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/action";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

const ModalContext = createContext<{ close: () => void } | null>(null);

export function SubmitButton({ children, variant = "primary", className = "" }: { children: ReactNode; variant?: "primary" | "secondary" | "danger"; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`btn btn-${variant} ${className}`}>
      {pending ? "Memproses..." : children}
    </button>
  );
}

export function ActionForm({
  action, children, className = "", resetOnSuccess = false, showOk = true,
}: { action: Action; children: ReactNode; className?: string; resetOnSuccess?: boolean; showOk?: boolean }) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const modal = useContext(ModalContext);
  useEffect(() => {
    if (state?.ok) {
      if (resetOnSuccess) ref.current?.reset();
      modal?.close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.at]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {state?.error && <p role="alert" className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      {showOk && !modal && state?.ok && <p className="mt-2 text-sm text-green-700">{state.ok}</p>}
    </form>
  );
}

/** Closes the surrounding Modal, if any. */
export function useModalClose() {
  return useContext(ModalContext)?.close;
}

export function Modal({ trigger, title, children, triggerClass = "btn btn-primary", wide = false }: { trigger: ReactNode; title: string; children: ReactNode; triggerClass?: string; wide?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={triggerClass} onClick={() => setOpen(true)}>{trigger}</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-16" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div role="dialog" aria-label={title} className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-xl bg-white p-5 shadow-xl`}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{title}</h2>
              <button type="button" aria-label="Tutup" className="text-slate-400 hover:text-slate-700" onClick={() => setOpen(false)}>✕</button>
            </div>
            <ModalContext.Provider value={{ close: () => setOpen(false) }}>{children}</ModalContext.Provider>
          </div>
        </div>
      )}
    </>
  );
}

/** Small inline form button for one-click actions (delete, toggle) with optional confirm. */
export function ActionButton({ action, fields, children, confirm, className = "btn btn-ghost text-sm" }: { action: Action; fields: Record<string, string | number>; children: ReactNode; confirm?: string; className?: string }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="inline" onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button type="submit" disabled={pending} className={className} title={state?.error}>{children}</button>
      {state?.error && <span role="alert" className="ml-2 text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
