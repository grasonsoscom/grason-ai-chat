"use client";

import { useCallback, useEffect, useState } from "react";
import { completeWaLogin, pollWaLogin, startWaLogin } from "./actions";

type View = { state: "loading" } | { state: "pending"; qr: string | null } | { state: "approved" } | { state: "error"; error: string };

export function WaQrLogin() {
  const [view, setView] = useState<View>({ state: "loading" });

  const start = useCallback(async () => {
    setView({ state: "loading" });
    try {
      await startWaLogin();
      setView({ state: "pending", qr: null });
    } catch {
      setView({ state: "error", error: "Gagal membuat kode QR. Coba lagi." });
    }
  }, []);

  useEffect(() => { void start(); }, [start]);

  useEffect(() => {
    if (view.state !== "pending") return;
    const t = setInterval(async () => {
      const s = await pollWaLogin().catch(() => null);
      if (!s) return;
      if (s.state === "approved") {
        setView({ state: "approved" });
        const r = await completeWaLogin();
        if (r?.error) setView({ state: "error", error: r.error });
      } else if (s.state === "error") {
        setView(s);
      } else if (s.qr !== (view.state === "pending" ? view.qr : null)) {
        setView(s);
      }
    }, 2000);
    return () => clearInterval(t);
  }, [view]);

  return (
    <div className="text-center">
      <div className="mx-auto flex h-[264px] w-[264px] items-center justify-center rounded-xl border border-slate-200 bg-white">
        {view.state === "pending" && view.qr
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={view.qr} alt="Kode QR login WhatsApp" width={264} height={264} />
          : view.state === "error"
            ? <p className="px-4 text-sm text-red-700" role="alert">{view.error}</p>
            : <p className="text-sm text-slate-500">{view.state === "approved" ? "Berhasil, sedang masuk..." : "Menyiapkan kode QR..."}</p>}
      </div>
      {view.state === "error" && (
        <button type="button" onClick={start} className="btn btn-primary mt-4 w-full">Muat ulang kode QR</button>
      )}
      <ol className="mt-5 list-decimal space-y-1 pl-5 text-left text-sm text-slate-600">
        <li>Buka WhatsApp di HP Anda.</li>
        <li>Ketuk <strong>Perangkat tertaut</strong> lalu <strong>Tautkan perangkat</strong>.</li>
        <li>Arahkan kamera ke kode QR ini.</li>
      </ol>
      <p className="mt-4 text-xs text-slate-500">
        Nomor WhatsApp harus sama dengan nomor di data Staf. Perangkat langsung dilepas otomatis setelah nomor terverifikasi.
      </p>
    </div>
  );
}
