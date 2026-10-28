"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useModalClose } from "@/components/forms";
import { cancelHubPairing, pollHubPairing, startHubPairing } from "./actions";

type View =
  | { state: "form" }
  | { state: "loading" }
  | { state: "pending"; qr: string | null }
  | { state: "connected" }
  | { state: "error"; error: string };

/** Modal body: enter a label, then scan the QR with WhatsApp → Perangkat tertaut. */
export function HubPairing({ defaultLabel = "" }: { defaultLabel?: string }) {
  const router = useRouter();
  const close = useModalClose();
  const [label, setLabel] = useState(defaultLabel);
  const [view, setView] = useState<View>({ state: "form" });
  const keyRef = useRef<string | null>(null);

  // Closing the modal mid-scan cancels the pairing.
  useEffect(() => () => {
    if (keyRef.current) void cancelHubPairing(keyRef.current);
  }, []);

  useEffect(() => {
    if (view.state !== "pending" || !keyRef.current) return;
    const key = keyRef.current;
    const t = setInterval(async () => {
      const s = await pollHubPairing(key).catch(() => null);
      if (!s) return;
      if (s.state === "connected") {
        keyRef.current = null;
        setView({ state: "connected" });
        router.refresh();
      } else if (s.state === "error") {
        keyRef.current = null;
        setView(s);
      } else if (s.qr !== view.qr) {
        setView(s);
      }
    }, 2000);
    return () => clearInterval(t);
  }, [view, router]);

  async function start() {
    setView({ state: "loading" });
    try {
      const r = await startHubPairing(label);
      if ("error" in r) return setView({ state: "error", error: r.error ?? "Terjadi kesalahan." });
      keyRef.current = r.key;
      setView({ state: "pending", qr: null });
    } catch {
      setView({ state: "error", error: "Gagal membuat kode QR. Coba lagi." });
    }
  }

  if (view.state === "form") {
    return (
      <form onSubmit={(e) => { e.preventDefault(); void start(); }}>
        <label className="mb-4 block text-sm">
          <span className="mb-1 block font-medium">Nama perangkat *</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} required className="input" placeholder="CS Toko" />
        </label>
        <button type="submit" className="btn btn-primary">Tampilkan Kode QR</button>
      </form>
    );
  }

  if (view.state === "connected") {
    return (
      <div className="text-center">
        <p className="mb-4 text-sm text-green-700">● Nomor berhasil ditautkan. Pesan masuk akan muncul di menu Pesan.</p>
        <button type="button" className="btn btn-primary" onClick={close}>Selesai</button>
      </div>
    );
  }

  return (
    <div className="text-center">
      <div className="mx-auto flex h-[264px] w-[264px] items-center justify-center rounded-xl border border-slate-200 bg-white">
        {view.state === "pending" && view.qr
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={view.qr} alt="Kode QR WhatsApp Hub" width={264} height={264} />
          : view.state === "error"
            ? <p className="px-4 text-sm text-red-700" role="alert">{view.error}</p>
            : <p className="text-sm text-slate-500">Menyiapkan kode QR...</p>}
      </div>
      {view.state === "error" && <button type="button" onClick={start} className="btn btn-primary mt-4">Coba lagi</button>}
      <ol className="mt-5 list-decimal space-y-1 pl-5 text-left text-sm text-slate-600">
        <li>Buka WhatsApp atau WhatsApp Business di HP nomor yang akan dihubungkan.</li>
        <li>Ketuk <strong>Perangkat tertaut</strong> lalu <strong>Tautkan perangkat</strong>.</li>
        <li>Arahkan kamera ke kode QR ini.</li>
      </ol>
      <p className="mt-4 text-left text-xs text-amber-700">
        WhatsApp Hub memakai koneksi tidak resmi (seperti WhatsApp Web). Pengiriman massal bisa membuat nomor diblokir WhatsApp.
      </p>
    </div>
  );
}
