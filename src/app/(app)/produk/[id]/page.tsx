import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { ImageInput } from "@/components/image-input";
import { Card, Field, Table, Tabs } from "@/components/ui";
import { db } from "@/lib/db";
import { formatIDR } from "@/lib/format";
import { addVariant, deleteImage, deleteVariant, saveGeneral, savePrompt } from "../actions";

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
                  <img src={`/api/uploads/${img.fileName}`} alt="" className="aspect-square w-full object-cover" />
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
          <Table head={["Variasi", "SKU", "Harga", ""]} empty={p.variants.length === 0}>
            {p.variants.map((v) => (
              <tr key={v.id}>
                <td className="px-4 py-3">{v.name}</td>
                <td className="px-4 py-3">{v.sku || "-"}</td>
                <td className="px-4 py-3">{formatIDR(v.price)}</td>
                <td className="px-4 py-3 text-right"><ActionButton action={deleteVariant} fields={{ id: v.id }} confirm="Hapus variasi ini?">🗑️</ActionButton></td>
              </tr>
            ))}
          </Table>
          <Card>
            <ActionForm action={addVariant} resetOnSuccess className="grid gap-3 sm:grid-cols-[1fr_140px_160px_auto] sm:items-end">
              <input type="hidden" name="productId" value={p.id} />
              <Field label="Nama variasi"><input name="name" required className="input" placeholder="1 Box" /></Field>
              <Field label="SKU"><input name="sku" className="input" /></Field>
              <Field label="Harga (Rp)"><input name="price" type="number" min={0} required className="input" /></Field>
              <div className="mb-3"><SubmitButton>Tambah</SubmitButton></div>
            </ActionForm>
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
