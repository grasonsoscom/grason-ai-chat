import Link from "next/link";
import { ActionButton } from "@/components/forms";
import { EmptyState, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { formatIDR } from "@/lib/format";
import { omsConfigured } from "@/lib/oms";
import { omsPriceMismatches } from "@/lib/oms-sync";
import { imageUrl } from "@/lib/uploads";
import { createProduct, deleteProduct } from "./actions";

export default async function ProdukPage() {
  const products = await db.product.findMany({ include: { images: { take: 1 }, variants: true }, orderBy: { createdAt: "desc" } });
  const addBtn = <form action={createProduct}><button className="btn btn-primary">+ Tambah Produk</button></form>;
  return (
    <div>
      <PageHeader title="Produk" subtitle="Katalog produk yang dipakai AI untuk menjawab pelanggan" actions={addBtn} />
      {omsConfigured() && <OmsPriceCheck />}
      {products.length === 0 ? (
        <EmptyState title="Belum ada produk" description="Tambahkan produk agar AI Agent bisa menjawab pertanyaan pelanggan." action={addBtn} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => {
            const prices = p.variants.map((v) => v.salePrice ?? v.price);
            return (
              <div key={p.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <Link href={`/produk/${p.id}`}>
                  <div className="flex h-40 items-center justify-center bg-slate-100">
                    {p.images[0]
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={imageUrl(p.images[0].fileName)} alt={p.name} className="h-full w-full object-cover" />
                      : <span className="text-4xl" aria-hidden>📦</span>}
                  </div>
                  <div className="p-4">
                    <p className="font-medium">{p.name}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-500">{p.description || "Belum ada deskripsi"}</p>
                    {prices.length > 0 && <p className="mt-2 text-sm font-medium text-green-700">{formatIDR(Math.min(...prices))}{prices.length > 1 && ` - ${formatIDR(Math.max(...prices))}`}</p>}
                  </div>
                </Link>
                <div className="flex justify-end border-t border-slate-100 px-2 py-1">
                  <ActionButton action={deleteProduct} fields={{ id: p.id }} confirm={`Hapus produk ${p.name}?`} className="btn btn-ghost text-xs text-red-600">Hapus</ActionButton>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Warns when a variant's price differs from OMS harga_jual: OMS then rejects the order (total_tidak_cocok). */
async function OmsPriceCheck() {
  let rows;
  try {
    rows = await omsPriceMismatches();
  } catch (e) {
    return <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">Harga OMS tidak bisa dicek: {(e as Error).message}</p>;
  }
  if (!rows.length) return null;
  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="font-medium">{rows.length} varian berbeda dengan harga OMS</p>
      <p className="mb-2 text-xs text-amber-800">Order ke OMS ditolak bila harga tidak sama. Samakan harga (harga promo bila diisi) dengan OMS, atau minta tim OMS memperbarui harganya.</p>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={`${r.productId}-${r.sku}`}>
            <Link href={`/produk/${r.productId}?tab=variasi`} className="underline">{r.name}</Link> ({r.sku}): di sini {formatIDR(r.ours)},{" "}
            {r.oms === null ? "SKU tidak ada di OMS" : `OMS ${formatIDR(r.oms)}`}
          </li>
        ))}
      </ul>
    </div>
  );
}
