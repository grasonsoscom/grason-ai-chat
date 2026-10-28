"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const NAV = [
  { href: "/pesan", label: "Pesan", icon: "💬" },
  { href: "/pelanggan", label: "Pelanggan", icon: "👥" },
  { href: "/kalender", label: "Kalender", icon: "📅" },
  { href: "/whatsapp", label: "WhatsApp Business", icon: "📱" },
  { href: "/produk", label: "Produk", icon: "📦" },
  { href: "/funnels", label: "Funnels", icon: "🪜" },
  { href: "/broadcast", label: "Broadcast", icon: "📣" },
  { href: "/audience", label: "Audience", icon: "🎯" },
  { href: "/staff", label: "Staff", icon: "🧑‍💼" },
  { href: "/ai-agent", label: "AI Agent", icon: "🤖" },
  { href: "/integrasi", label: "Integrasi", icon: "🔌" },
];

export function Sidebar() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-label="Menu" className="fixed left-3 top-3 z-40 rounded-lg bg-white p-2 shadow md:hidden" onClick={() => setOpen(!open)}>☰</button>
      <aside className={`fixed inset-y-0 left-0 z-30 w-60 shrink-0 border-r border-slate-200 bg-white transition-transform md:static md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-16 items-center gap-2 border-b border-slate-100 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-600 font-bold text-white">G</div>
          <span className="font-semibold">GrasOn AI Chat</span>
        </div>
        <nav className="space-y-0.5 p-3">
          {NAV.map((n) => {
            const active = path === n.href || path.startsWith(n.href + "/");
            return (
              <Link key={n.href} href={n.href} onClick={() => setOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${active ? "bg-green-50 font-medium text-green-700" : "text-slate-600 hover:bg-slate-50"}`}>
                <span aria-hidden className="w-5 text-center">{n.icon}</span>
                {n.label}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

export function Banner() {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <div className="flex items-center justify-between gap-3 bg-green-600 py-2 pl-14 pr-4 text-sm text-white md:pl-4">
      <span>✨ Update fitur AI: balasan lebih natural untuk meningkatkan conversion rate.</span>
      <button type="button" aria-label="Tutup pengumuman" onClick={() => setHidden(true)} className="opacity-80 hover:opacity-100">✕</button>
    </div>
  );
}
