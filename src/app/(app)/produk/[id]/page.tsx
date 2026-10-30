import Link from "next/link";
import { notFound } from "next/navigation";
import type { ProductVariant } from "@prisma/client";
import { ActionButton, ActionForm, Modal, SubmitButton } from "@/components/forms";
import { ImageInput } from "@/components/image-input";
import { Card, Field, Table, Tabs } from "@/components/ui";
import { db } from "@/lib/db";
import { formatIDR } from "@/lib/format";
import { imageUrl } from "@/lib/uploads";
import { deleteImage, deleteVariant, saveGeneral, savePrompt, saveVariant } from "../actions";

export default async function EditProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const id = Number((await params).id);
  const tab = (await searchParams).tab ?? "umum";
  const p = await db.product.findUnique({ where: { id }, include: { images: true, variants: true } });
  if (!p) notFound();
  const base = `/produk/${id}`;

  return (
    <div className="max-w-3xl">
      <Link href="/produk" className="text-sm text-slate-500 hover:text-slate-800">‹ Kembali ke Produk</Link>
      <h1 className="mb-4 mt-2 text-2xl font-semibold">Edit Product</h1>
      <Tabs active={tab} tabs={[
        { key: "umum", label: "Umum", href: base },
        { key: "variasi", label: "Variasi", href: `${base}?tab=variasi` },
        { key: "prompt", label: "Pengaturan Prompt AI", href: `${base}?tab=prompt` },
      ]} />

      {tab === "umum" && (
        <Card>
          <ActionForm action={saveGeneral}>
            <input type="hidden" name="id" value={p.id} />
            <Field label="Nama *"><input name="name" required defaultValue={p.name} className="input" /></Field>
            <Field label="Deskripsi"><textarea name="description" rows={5} defaultValue={p.description} className="input" /></Field>
            <div className="mb-3">
              <p className="mb-1 text-sm font-medium text-slate-700">Product Images</p>
              <p className="mb-2 text-xs text-slate-500">Gambar dipakai AI untuk menjawab pertanyaan seperti BPOM, sertifikasi halal, dan aturan penyajian.</p>
              <ImageInput name="images" />
            </div>
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
          {p.images.length > 0 && (
            <div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-4">
              {p.images.map((img) => (
                <div key={img.id} className="relative overflow-hidden rounded-lg border border-slate-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageUrl(img.fileName)} alt="" className="aspect-square w-full object-cover" />
                  <div className="absolute right-1 top-1 rounded bg-white/90">
                    <ActionButton action={deleteImage} fields={{ id: img.id }} confirm="Hapus gambar ini?" className="px-1.5 text-sm">🗑️</ActionButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === "variasi" && (
        <div className="space-y-4">
          <Table head={["Variant Name", "SKU", "Weight (gram)", "Price", "Sale Price", ""]} empty={p.variants.length === 0}>
            {p.variants.map((v) => (
              <tr key={v.id}>
                <td className="px-4 py-3 font-medium">{v.name}</td>
                <td className="px-4 py-3">{v.sku || "-"}</td>
                <td className="px-4 py-3">{v.weight ? v.weight.toLocaleString("id-ID") : "-"}</td>
                <td className="px-4 py-3">{v.salePrice !== null ? <span className="text-slate-400 line-through">{formatIDR(v.price)}</span> : formatIDR(v.price)}</td>
                <td className="px-4 py-3 font-medium text-green-700">{v.salePrice !== null ? formatIDR(v.salePrice) : "-"}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <Modal trigger="✏️" title={`Edit Variasi ${v.name}`} triggerClass="btn btn-ghost text-sm"><VariantForm productId={p.id} variant={v} /></Modal>
                  <ActionButton action={deleteVariant} fields={{ id: v.id }} confirm="Hapus variasi ini?">🗑️</ActionButton>
                </td>
              </tr>
            ))}
          </Table>
          <Card>
            <p className="mb-3 font-medium">Tambah variasi</p>
            <VariantForm productId={p.id} />
          </Card>
        </div>
      )}

      {tab === "prompt" && (
        <Card>
          <ActionForm action={savePrompt}>
            <input type="hidden" name="id" value={p.id} />
            <Field label="Instruksi tambahan untuk AI" hint="Info khusus produk ini yang perlu diketahui AI, misalnya cara penyajian atau jawaban untuk pertanyaan umum.">
              <textarea name="aiPrompt" rows={8} defaultValue={p.aiPrompt} className="input" />
            </Field>
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}

function VariantForm({ productId, variant }: { productId: number; variant?: ProductVariant }) {
  return (
    <ActionForm action={saveVariant} resetOnSuccess={!variant} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="productId" value={productId} />
      {variant && <input type="hidden" name="id" value={variant.id} />}
      <Field label="Variant Name *"><input name="name" required defaultValue={variant?.name} className="input" placeholder="1 box" /></Field>
      <Field label="SKU"><input name="sku" defaultValue={variant?.sku} className="input" /></Field>
      <Field label="Weight (gram)"><input name="weight" type="number" min={0} defaultValue={variant?.weight || ""} className="input" placeholder="200" /></Field>
      <Field label="Price (Rp) *" hint="Harga normal"><input name="price" type="number" min={0} required defaultValue={variant?.price} className="input" /></Field>
      <Field label="Sale Price (Rp)" hint="Harga promo. Kosongkan jika tidak ada promo."><input name="salePrice" type="number" min={0} defaultValue={variant?.salePrice ?? ""} className="input" /></Field>
      <div className="flex items-end sm:col-span-2"><SubmitButton>{variant ? "Simpan" : "Tambah"}</SubmitButton></div>
    </ActionForm>
  );
}
