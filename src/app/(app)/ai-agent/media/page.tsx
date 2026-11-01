import Link from "next/link";
import type { MediaAsset } from "@prisma/client";
import { ActionButton, ActionForm, Modal, SubmitButton } from "@/components/forms";
import { MediaInput } from "@/components/media-input";
import { Badge, Card, EmptyState, Field, PageHeader } from "@/components/ui";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { KIND_LABEL, mediaUrl, type MediaKind } from "@/lib/media";
import { deleteMedia, toggleMedia, updateMedia, uploadMedia } from "./actions";

export default async function MediaTestimoniPage() {
  await requirePageAccess("ai-agent");
  const [media, products] = await Promise.all([
    db.mediaAsset.findMany({ include: { product: { select: { name: true } } }, orderBy: { id: "desc" } }),
    db.product.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="max-w-5xl">
      <Link href="/ai-agent" className="text-sm text-slate-500 hover:text-slate-800">‹ Kembali ke AI Agent</Link>
      <PageHeader
        title="Media Testimoni"
        subtitle="Foto dan video yang boleh dikirim AI Agent saat pelanggan minta testimoni atau bukti. Staf juga bisa mengirimnya dari Pesan."
      />

      <Card className="mb-6">
        <p className="mb-3 font-medium">Tambah media</p>
        <ActionForm action={uploadMedia} resetOnSuccess className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><MediaInput name="file" /></div>
          <MediaFields products={products} />
          <div className="sm:col-span-2"><SubmitButton>Unggah</SubmitButton></div>
        </ActionForm>
        <p className="mt-3 text-xs text-slate-500">
          Pastikan pembeli sudah mengizinkan foto, video, atau chat-nya dipakai. Tutup nama dan nomor WhatsApp di screenshot.
        </p>
      </Card>

      {media.length === 0 ? (
        <EmptyState title="Belum ada media testimoni" description="Unggah foto atau video testimoni supaya AI bisa mengirimkannya ke pelanggan." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {media.map((m) => (
            <div key={m.id} className={`overflow-hidden rounded-xl border bg-white ${m.active ? "border-slate-200" : "border-slate-200 opacity-60"}`}>
              {m.kind === "video" ? (
                <video src={mediaUrl(m.id)} controls preload="metadata" className="aspect-square w-full bg-black object-contain" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaUrl(m.id)} alt={m.title} className="aspect-square w-full bg-slate-50 object-contain" />
              )}
              <div className="space-y-1 p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{m.title}</p>
                  <Badge tone={m.active ? "green" : "slate"}>{m.active ? "Aktif" : "Nonaktif"}</Badge>
                </div>
                <p className="text-xs text-slate-500">
                  {KIND_LABEL[m.kind as MediaKind] ?? "Media"} · {(m.size / 1024 / 1024).toFixed(1)} MB · {m.product?.name ?? "Semua produk"}
                </p>
                {m.usage && <p className="text-xs text-slate-600"><span className="font-medium">Kirim bila:</span> {m.usage}</p>}
                {m.caption && <p className="text-xs text-slate-600"><span className="font-medium">Caption:</span> {m.caption}</p>}
                <div className="flex flex-wrap gap-1 pt-1">
                  <Modal trigger="Ubah" title={`Ubah ${m.title}`} triggerClass="btn btn-ghost text-xs">
                    <ActionForm action={updateMedia} className="grid gap-3">
                      <input type="hidden" name="id" value={m.id} />
                      <MediaFields products={products} media={m} />
                      <SubmitButton>Simpan</SubmitButton>
                    </ActionForm>
                  </Modal>
                  <ActionButton action={toggleMedia} fields={{ id: m.id }} className="btn btn-ghost text-xs">
                    {m.active ? "Nonaktifkan" : "Aktifkan"}
                  </ActionButton>
                  <ActionButton action={deleteMedia} fields={{ id: m.id }} confirm={`Hapus ${m.title}? File ikut terhapus.`} className="btn btn-ghost text-xs text-red-600">
                    Hapus
                  </ActionButton>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MediaFields({ products, media }: { products: { id: number; name: string }[]; media?: MediaAsset }) {
  return (
    <>
      <Field label="Judul *" hint="Dilihat AI dan staf, tidak dikirim ke pelanggan.">
        <input name="title" required maxLength={120} defaultValue={media?.title} className="input" placeholder="Testimoni Bio Serea – kulit lebih cerah" />
      </Field>
      <Field label="Produk" hint="Kosongkan bila berlaku untuk semua produk.">
        <select name="productId" defaultValue={media?.productId ?? ""} className="input">
          <option value="">Semua produk</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      <Field label="Kapan AI boleh mengirim" hint="Mis. pelanggan tanya hasil pemakaian, ragu soal keaslian, minta bukti pengiriman.">
        <textarea name="usage" rows={2} maxLength={500} defaultValue={media?.usage} className="input" />
      </Field>
      <Field label="Caption" hint="Ikut terkirim bersama foto/video. Boleh kosong.">
        <textarea name="caption" rows={2} maxLength={1000} defaultValue={media?.caption} className="input" />
      </Field>
    </>
  );
}
