import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-slate-200 bg-white p-5 ${className}`}>{children}</div>;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start justify-center rounded-lg border border-dashed border-slate-300 bg-white px-6 py-10 sm:items-center sm:text-center">
      <p className="text-base font-semibold text-slate-900">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-slate-600">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function AccessDenied({ message = "Halaman ini hanya dapat diakses oleh Admin." }: { message?: string }) {
  return (
    <div className="rounded-lg border border-kunyit/40 bg-kunyit-soft p-6 text-sm text-kunyit-ink">
      <p className="font-medium">Akses ditolak</p>
      <p className="mt-1">{message}</p>
    </div>
  );
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "blue" | "amber" | "red" | "purple" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700", green: "bg-green-100 text-green-700", blue: "bg-blue-100 text-blue-700",
    amber: "bg-kunyit-soft text-kunyit-ink", red: "bg-red-100 text-red-800", purple: "bg-purple-100 text-purple-800",
  };
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

export function Tabs({ tabs, active }: { tabs: { key: string; label: string; href: string; badge?: ReactNode }[]; active: string }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold ${
            t.key === active ? "border-green-600 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          {t.label}
          {t.badge}
        </Link>
      ))}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-sm font-semibold text-slate-800">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-xs text-slate-600">
          <tr>{head.map((h) => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {empty ? (
            <tr><td colSpan={head.length} className="px-4 py-12 text-center text-slate-500">Belum ada data.</td></tr>
          ) : children}
        </tbody>
      </table>
    </div>
  );
}
