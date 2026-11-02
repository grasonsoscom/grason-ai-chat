"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type KeyboardEvent } from "react";

/** How often the open inbox checks for changes (only while the tab is visible). */
const SELANG_MS = 3000;

/**
 * Keeps the Pesan page live: polls a cheap change marker and re-renders the server
 * components when it changes, so incoming messages, AI replies and delivery ticks show
 * without a manual refresh. Typed text in the composer is kept across refreshes.
 */
export function PesanLangsung({ c }: { c?: string }) {
  const router = useRouter();
  const versi = useRef<string | null>(null);
  const judulAsli = useRef<string | null>(null);

  useEffect(() => {
    judulAsli.current ??= document.title;
    let aktif = true;
    let sibuk = false;

    async function periksa() {
      if (sibuk || document.visibilityState !== "visible") return;
      sibuk = true;
      try {
        const res = await fetch(`/api/pesan/denyut${c ? `?c=${encodeURIComponent(c)}` : ""}`, { cache: "no-store" });
        if (!res.ok || !aktif) return;
        const data = (await res.json()) as { versi: string; belumDibaca: number };
        document.title = data.belumDibaca > 0 ? `(${data.belumDibaca}) Pesan · GrasOn` : (judulAsli.current ?? "GrasOn AI Chat");
        if (versi.current !== null && versi.current !== data.versi) router.refresh();
        versi.current = data.versi;
      } catch {
        // Offline for a moment: try again on the next tick.
      } finally {
        sibuk = false;
      }
    }

    void periksa();
    const timer = setInterval(() => void periksa(), SELANG_MS);
    const saatTerlihat = () => void periksa();
    document.addEventListener("visibilitychange", saatTerlihat);
    window.addEventListener("focus", saatTerlihat);
    return () => {
      aktif = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", saatTerlihat);
      window.removeEventListener("focus", saatTerlihat);
      if (judulAsli.current) document.title = judulAsli.current;
    };
  }, [c, router]);

  // A new conversation was opened: take its marker afresh.
  useEffect(() => {
    versi.current = null;
  }, [c]);

  return null;
}

/** Message box: Enter sends, Shift+Enter adds a new line (like WhatsApp Web). */
export function KotakTulis() {
  function tekan(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (e.currentTarget.value.trim()) e.currentTarget.form?.requestSubmit();
  }
  return (
    <textarea
      name="text"
      required
      rows={2}
      maxLength={4096}
      placeholder="Tulis pesan… (Enter kirim, Shift+Enter baris baru)"
      aria-label="Tulis pesan"
      className="input min-h-[52px] resize-none py-2.5 text-[15px] leading-snug"
      onKeyDown={tekan}
    />
  );
}
