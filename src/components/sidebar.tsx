"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { ModuleKey } from "@/lib/permissions";

// `module` hides the item unless the role has that module (see lib/permissions).
type NavItem = { href: string; label: string; icon: keyof typeof IKON; adminOnly?: boolean; module?: ModuleKey };
type NavGroup = { label?: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    items: [
      { href: "/pesan", label: "Pesan", icon: "pesan", module: "pesan" },
      { href: "/pelanggan", label: "Pelanggan", icon: "orang", module: "pelanggan" },
      { href: "/kalender", label: "Kalender", icon: "kalender", module: "kalender" },
    ],
  },
  {
    label: "Perpesanan",
    items: [{ href: "/whatsapp", label: "WhatsApp Business", icon: "ponsel", module: "whatsapp" }],
  },
  {
    label: "Penjualan",
    items: [
      { href: "/monitor-order", label: "Monitor Order", icon: "sinyal", module: "pesan" },
      { href: "/ongkir", label: "Cek Ongkir", icon: "truk" },
      { href: "/produk", label: "Produk", icon: "kotak", module: "produk" },
      { href: "/funnels", label: "Funnels", icon: "corong", module: "funnels" },
      { href: "/broadcast", label: "Broadcast", icon: "toa", module: "broadcast" },
      { href: "/audience", label: "Audience", icon: "target", module: "audience" },
    ],
  },
  {
    label: "Tim",
    items: [
      { href: "/staff", label: "Staff", icon: "tim", module: "staff" },
      { href: "/ai-agent", label: "AI Agent", icon: "bintang", module: "ai-agent" },
      { href: "/laporan", label: "Laporan", icon: "grafik", module: "laporan" },
    ],
  },
  {
    label: "Sistem",
    items: [{ href: "/integrasi", label: "Integrasi", icon: "colokan", module: "integrasi" }],
  },
  {
    label: "Developer",
    items: [
      { href: "/developer/api-docs", label: "API Docs", icon: "buku" },
      { href: "/developer/api-tokens", label: "API Tokens", icon: "kunci", adminOnly: true },
      { href: "/developer/webhooks", label: "Webhooks", icon: "kait", adminOnly: true },
    ],
  },
];

/** Line icons (24px grid, stroke = currentColor) so the menu reads as one set. */
const IKON = {
  pesan: "M4 5h16v11H9l-5 4z",
  orang: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.5c2 .7 3.2 2.6 3.5 5.5",
  kalender: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  ponsel: "M7 2.5h10v19H7zM11 18h2",
  sinyal: "M3 12h4l3-7 4 14 3-7h4",
  truk: "M2.5 6h11v10h-11zM13.5 9.5h4l3 3.5v3h-7M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  kotak: "M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5zM3.5 7.5 12 12l8.5-4.5M12 12v9",
  corong: "M3 4h18l-7 8.5V19l-4 2v-8.5z",
  toa: "M3 10v4h3l7 4V6l-7 4zM17 9a4 4 0 0 1 0 6M19.5 6.5a7.5 7.5 0 0 1 0 11",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01",
  tim: "M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM5 20c.9-3.6 3.6-5.5 7-5.5s6.1 1.9 7 5.5",
  bintang: "M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4zM18.5 16.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z",
  grafik: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  colokan: "M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4",
  buku: "M4 4.5h6a2 2 0 0 1 2 2V20a1.5 1.5 0 0 0-1.5-1.5H4zM20 4.5h-6a2 2 0 0 0-2 2V20a1.5 1.5 0 0 1 1.5-1.5H20z",
  kunci: "M8 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM11 11h10M17 11v3M20 11v2",
  kait: "M9 7a3 3 0 1 1 3 3v3a4 4 0 1 0 4 4M5 15a4 4 0 0 0 4 4",
} as const;

function Ikon({ nama }: { nama: keyof typeof IKON }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0" aria-hidden>
      <path d={IKON[nama]} />
    </svg>
  );
}

export function Sidebar({ isAdmin = false, modules = [] }: { isAdmin?: boolean; modules?: ModuleKey[] }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  // In Pesan the menu shrinks to an icon rail (md+) so the chat gets the room.
  const ciut = path === "/pesan" || path.startsWith("/pesan/");

  return (
    <>
      <button
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        className="fixed left-3 top-3 z-40 rounded-md bg-tinta p-2 text-white shadow md:hidden"
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-5 w-5" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-64 shrink-0 overflow-y-auto bg-tinta text-slate-300 transition-transform md:static md:translate-x-0 ${
          ciut ? "md:w-16" : "md:w-60"
        } ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className={`flex h-16 items-center gap-3 px-5 ${ciut ? "md:justify-center md:px-0" : ""}`}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-green-600 text-base font-extrabold text-white">G</span>
          <span className={`leading-tight ${ciut ? "md:hidden" : ""}`}>
            <span className="block text-[15px] font-bold text-white">GrasOn</span>
            <span className="block text-xs text-slate-400">AI Chat</span>
          </span>
        </div>
        <nav className={`space-y-4 px-3 pb-6 pt-2 ${ciut ? "md:px-2" : ""}`}>
          {GROUPS.map((group) => {
            const items = group.items.filter(
              (item) => (!item.adminOnly || isAdmin) && (!item.module || modules.includes(item.module)),
            );
            if (!items.length) return null;
            return (
              <div key={group.label ?? "utama"}>
                {group.label && (
                  <p className={`px-3 pb-1.5 text-xs font-medium text-slate-500 ${ciut ? "md:sr-only" : ""}`}>{group.label}</p>
                )}
                <div className="space-y-0.5">
                  {items.map((item) => {
                    const active = path === item.href || path.startsWith(item.href + "/");
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        title={ciut ? item.label : undefined}
                        aria-current={active ? "page" : undefined}
                        onClick={() => setOpen(false)}
                        className={`relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                          ciut ? "md:justify-center md:px-0" : ""
                        } ${active ? "bg-tinta-soft font-semibold text-white" : "hover:bg-tinta-soft/60 hover:text-white"}`}
                      >
                        {active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-1 rounded-r bg-green-400" />}
                        <Ikon nama={item.icon} />
                        <span className={ciut ? "md:sr-only" : ""}>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>
      {open && <button type="button" aria-label="Tutup menu" className="fixed inset-0 z-20 bg-tinta/40 md:hidden" onClick={() => setOpen(false)} />}
    </>
  );
}

export function Banner() {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-green-200 bg-green-100 py-2 pl-14 pr-4 text-sm text-green-900 md:pl-4">
      <span>Update fitur AI: balasan lebih natural untuk meningkatkan conversion rate.</span>
      <button type="button" aria-label="Tutup pengumuman" onClick={() => setHidden(true)} className="rounded px-1 text-green-800 hover:bg-green-200">✕</button>
    </div>
  );
}
