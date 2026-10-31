import Link from "next/link";
import { RajaOngkirCheck } from "@/components/rajaongkir-checker";
import { Badge, PageHeader } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { getRajaOngkirStatus } from "@/lib/rajaongkir";

export default async function OngkirPage() {
  const [status, user] = await Promise.all([getRajaOngkirStatus(), getCurrentUser()]);
  const isAdmin = user?.role.name === "Admin";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cek Ongkir"
        subtitle="Tarif real-time RajaOngkir berdasarkan kota asal, daerah tujuan, berat, dan kurir."
        actions={status.configured ? <Badge tone="green">Aktif</Badge> : <Badge tone="amber">Belum dikonfigurasi</Badge>}
      />

      {status.configured ? (
        <div className="max-w-3xl rounded-xl border border-slate-200 bg-white p-5">
          <RajaOngkirCheck
            originLabel={status.originLabel}
            defaultCourier={status.courier}
            defaultWeight={status.weight}
          />
          <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
            Tarif berasal langsung dari RajaOngkir dan dapat berbeda dari tabel J&T yang dipakai AI Agent.
            Hasil di sini tidak otomatis mengubah ongkir pesanan; gunakan tombol <strong>Pakai</strong> saat membuat order OMS
            atau isi ongkir manual di form order.
          </p>
        </div>
      ) : (
        <div className="max-w-2xl rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <p className="font-medium">RajaOngkir belum dikonfigurasi.</p>
          <p className="mt-1">
            Isi API key Shipping Cost dan pilih kota asal pengiriman di Integrasi terlebih dahulu.
          </p>
          {isAdmin && (
            <Link href="/integrasi" className="btn btn-primary mt-4">Buka Integrasi</Link>
          )}
        </div>
      )}
    </div>
  );
}
