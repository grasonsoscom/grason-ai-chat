"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

type NavItem = { href: string; label: string; icon: string; adminOnly?: boolean };
type NavGroup = { label?: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    items: [
      { href: "/pesan", label: "Pesan", icon: "💬" },
      { href: "/pelanggan", label: "Pelanggan", icon: "👥" },
      { href: "/kalender", label: "Kalender", icon: "📅" },
    ],
  },
  {
    label: "Messaging",
    items: [{ href: "/whatsapp", label: "WhatsApp Business", icon: "📱" }],
  },
  {
    label: "Commerce",
    items: [
      { href: "/ongkir", label: "Cek Ongkir", icon: "🚚" },
      { href: "/produk", label: "Produk", icon: "📦" },
      { href: "/funnels", label: "Funnels", icon: "🪜" },
      { href: "/broadcast", label: "Broadcast", icon: "📣" },
      { href: "/audience", label: "Audience", icon: "🎯" },
    ],
  },
  {
    label: "Team",
    items: [
      { href: "/staff", label: "Staff", icon: "🧑‍💼" },
      { href: "/ai-agent", label: "AI Agent", icon: "🤖" },
    ],
  },
  {
    label: "System",
    items: [{ href: "/integrasi", label: "Integrasi", icon: "🔌" }],
  },
  {
    label: "Developer",
    items: [
      { href: "/developer/api-docs", label: "API Docs", icon: "📖" },
      { href: "/developer/api-tokens", label: "API Tokens", icon: "🔑", adminOnly: true },
      { href: "/developer/webhooks", label: "Webhooks", icon: "🪝", adminOnly: true },
    ],
  },
];

export function Sidebar({ isAdmin = false }: { isAdmin?: boolean }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" aria-label="Menu" className="fixed left-3 top-3 z-40 rounded-lg bg-white p-2 shadow md:hidden" onClick={() => setOpen(!open)}>☰</button>
      <aside className={`fixed inset-y-0 left-0 z-30 w-60 shrink-0 overflow-y-auto border-r border-slate-200 bg-white transition-transform md:static md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-16 items-center gap-2 border-b border-slate-100 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-600 font-bold text-white">G</div>
          <span className="font-semibold">GrasOn AI Chat</span>
        </div>
        <nav className="space-y-1 p-3">
          {GROUPS.map((group) => {
            const items = group.items.filter((item) => !item.adminOnly || isAdmin);
            if (!items.length) return null;
            return (
              <div key={group.label ?? "main"} className="pb-1">
                {group.label && (
                  <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {group.label}
                  </p>
                )}
                {items.map((item) => {
                  const active = path === item.href || path.startsWith(item.href + "/");
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${active ? "bg-green-50 font-medium text-green-700" : "text-slate-600 hover:bg-slate-50"}`}
                    >
                      <span aria-hidden className="w-5 text-center">{item.icon}</span>
                      {item.label}
                    </Link>
                  );
                })}
              </div>
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
