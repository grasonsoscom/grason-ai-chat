"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { optId, required, run, str, type ActionState } from "@/lib/action";
import { removeMedia, saveMedia } from "@/lib/media";

function fields(fd: FormData) {
  const productId = optId(fd, "productId");
  return {
    title: required(fd, "title", "Judul"),
    usage: str(fd, "usage").slice(0, 500),
    caption: str(fd, "caption").slice(0, 1000),
    productId: productId ?? null,
  };
}

export async function uploadMedia(_: ActionState, fd: FormData) {
  return run(async () => {
    await requirePermission("ai-agent");
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Pilih file foto atau video.");
    const data = fields(fd);
    const saved = await saveMedia(file);
    await db.mediaAsset.create({ data: { ...data, ...saved } });
    revalidatePath("/ai-agent/media");
    return "Media ditambahkan.";
  });
}

export async function updateMedia(_: ActionState, fd: FormData) {
  return run(async () => {
    await requirePermission("ai-agent");
    await db.mediaAsset.update({ where: { id: Number(fd.get("id")) }, data: fields(fd) });
    revalidatePath("/ai-agent/media");
    return "Media disimpan.";
  });
}

export async function toggleMedia(_: ActionState, fd: FormData) {
  return run(async () => {
    await requirePermission("ai-agent");
    const id = Number(fd.get("id"));
    const m = await db.mediaAsset.findUniqueOrThrow({ where: { id } });
    await db.mediaAsset.update({ where: { id }, data: { active: !m.active } });
    revalidatePath("/ai-agent/media");
    return m.active ? "Media dinonaktifkan." : "Media diaktifkan.";
  });
}

export async function deleteMedia(_: ActionState, fd: FormData) {
  return run(async () => {
    await requirePermission("ai-agent");
    const m = await db.mediaAsset.delete({ where: { id: Number(fd.get("id")) } });
    await removeMedia(m.fileName);
    revalidatePath("/ai-agent/media");
    return "Media dihapus.";
  });
}
