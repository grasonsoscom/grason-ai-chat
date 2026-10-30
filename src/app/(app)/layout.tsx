import Link from "next/link";
import { Banner, Sidebar } from "@/components/sidebar";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logout } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const unreadCount = await db.conversation.count({ where: { unread: { gt: 0 } } });

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Banner />
        <header className="flex h-16 items-center justify-end gap-3 border-b border-slate-200 bg-white px-4 pl-14 md:pl-4">
          <Link href="/pesan" className="relative rounded-lg p-2 hover:bg-slate-100" aria-label="Notifikasi">
            🔔
            {unreadCount > 0 && (
              <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1.5 text-[10px] font-semibold text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Link>
          <span className="text-sm text-slate-500">ID</span>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-sm font-semibold text-green-700" title={user.name}>
              {user.name.charAt(0).toUpperCase()}
            </div>
            <form action={logout}>
              <button className="text-sm text-slate-500 hover:text-slate-800">Keluar</button>
            </form>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
