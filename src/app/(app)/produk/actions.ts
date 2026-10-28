"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { num, required, run, str, type ActionState } from "@/lib/action";
import { removeImage, saveImage } from "@/lib/uploads";

export async function createProduct() {
  await requireUser();
  const p = await db.product.create({ data: { name: "Produk baru" } });
  redirect(`/produk/${p.id}`);
}

export async function saveGeneral(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    const id = Number(fd.get("id"));
    const files = fd.getAll("images").filter((f): f is File => f instanceof File && f.size > 0);
    // Validate every file before storing any, so a bad file doesn't leave a partial upload.
    for (const f of files) {
      if (f.size > 2 * 1024 * 1024) throw new Error(`"${f.name}" melebihi batas 2 MB.`);
    }
    const saved = [];
    for (const f of files) saved.push(await saveImage(f));
    await db.product.update({
      where: { id },
      data: {
        name: required(fd, "name", "Nama"),
        description: str(fd, "description"),
        images: { create: saved },
      },
    });
    revalidatePath(`/produk/${id}`);
    revalidatePath("/produk");
    return "Produk disimpan.";
  });
}

export async function deleteImage(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    const img = await db.productImage.delete({ where: { id: Number(fd.get("id")) } });
    await removeImage(img.fileName);
    revalidatePath(`/produk/${img.productId}`);
    return "Gambar dihapus.";
  });
}

export async function addVariant(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    const productId = Number(fd.get("productId"));
    const price = num(fd, "price");
    if (price < 0) throw new Error("Harga tidak boleh negatif.");
    await db.productVariant.create({ data: { productId, name: required(fd, "name", "Nama variasi"), price, sku: str(fd, "sku") } });
    revalidatePath(`/produk/${productId}`);
    return "Variasi ditambahkan.";
  });
}

export async function deleteVariant(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    const v = await db.productVariant.delete({ where: { id: Number(fd.get("id")) } });
    revalidatePath(`/produk/${v.productId}`);
    return "Variasi dihapus.";
  });
}

export async function savePrompt(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    const id = Number(fd.get("id"));
    await db.product.update({ where: { id }, data: { aiPrompt: str(fd, "aiPrompt") } });
    revalidatePath(`/produk/${id}`);
    return "Pengaturan prompt AI disimpan.";
  });
}

export async function deleteProduct(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    const id = Number(fd.get("id"));
    const imgs = await db.productImage.findMany({ where: { productId: id } });
    await db.product.delete({ where: { id } });
    await Promise.all(imgs.map((i) => removeImage(i.fileName)));
    revalidatePath("/produk");
    return "Produk dihapus.";
  });
}
