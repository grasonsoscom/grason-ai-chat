import Link from "next/link";
import { Banner, Sidebar } from "@/components/sidebar";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { allowedModules } from "@/lib/permissions";
import { logout } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const unreadCount = await db.conversation.count({ where: { unread: { gt: 0 } } });

  return (
    <div className="flex min-h-screen">
      <Sidebar isAdmin={user.role.name === "Admin"} modules={allowedModules(user.role)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Banner />
        <header className="flex h-14 items-center justify-end gap-4 border-b border-slate-200 bg-white px-4 pl-14 md:pl-6">
          <Link
            href="/pesan"
            className="relative rounded-md p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            aria-label={unreadCount > 0 ? `${unreadCount} percakapan belum dibaca` : "Pesan"}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
              <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9zM10 19a2 2 0 0 0 4 0" />
            </svg>
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-kunyit px-1 text-center text-[11px] font-bold leading-5 text-tinta">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Link>
          <div className="flex items-center gap-3 border-l border-slate-200 pl-4">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-sm font-bold text-green-800" aria-hidden>
              {user.name.charAt(0).toUpperCase()}
            </span>
            <span className="hidden text-sm leading-tight sm:block">
              <span className="block font-semibold text-slate-900">{user.name}</span>
              <span className="block text-xs text-slate-500">{user.role.name}</span>
            </span>
            <form action={logout}>
              <button className="rounded-md px-2 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900">Keluar</button>
            </form>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
