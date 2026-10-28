"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { renumberFunnel } from "@/lib/funnel";
import { num, required, run, str, type ActionState } from "@/lib/action";

const done = (msg: string) => { revalidatePath("/funnels"); return msg; };

export async function addFunnel(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    await db.funnel.create({ data: { name: required(fd, "name", "Nama funnel"), levels: { create: { order: 1 } } } });
    return done("Funnel dibuat.");
  });
}

export async function deleteFunnel(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    await db.funnel.delete({ where: { id: Number(fd.get("id")) } });
    return done("Funnel dihapus.");
  });
}

/** Inserts a new level before the given position (1-based). */
export async function insertLevel(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    const funnelId = Number(fd.get("funnelId"));
    const position = num(fd, "position");
    await db.funnelLevel.updateMany({ where: { funnelId, order: { gte: position } }, data: { order: { increment: 1 } } });
    await db.funnelLevel.create({ data: { funnelId, order: position } });
    await renumberFunnel(funnelId);
    return done("Tingkat ditambahkan.");
  });
}

export async function deleteLevel(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    const level = await db.funnelLevel.findUniqueOrThrow({ where: { id: Number(fd.get("id")) }, include: { _count: { select: { stages: true } } } });
    if (level._count.stages > 0) throw new Error("Hapus atau pindahkan semua tahapan di tingkat ini terlebih dahulu.");
    await db.funnelLevel.delete({ where: { id: level.id } });
    await renumberFunnel(level.funnelId);
    return done("Tingkat dihapus.");
  });
}

export async function saveStage(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    const id = Number(fd.get("id")) || null;
    const levelId = Number(fd.get("levelId"));
    const level = await db.funnelLevel.findUniqueOrThrow({ where: { id: levelId } });
    const data = { name: required(fd, "name", "Nama tahapan"), description: str(fd, "description"), aiEnabled: fd.get("aiEnabled") === "on" };
    if (id) {
      const prev = await db.funnelStage.findUniqueOrThrow({ where: { id } });
      // Moving to another level appends to the end of that level.
      const order = prev.levelId === levelId ? prev.order : 10_000;
      await db.funnelStage.update({ where: { id }, data: { ...data, levelId, order } });
    } else {
      await db.funnelStage.create({ data: { ...data, levelId, order: 10_000 } });
    }
    await renumberFunnel(level.funnelId);
    return done(id ? "Tahapan diperbarui." : "Tahapan ditambahkan.");
  });
}

export async function deleteStage(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    const stage = await db.funnelStage.delete({ where: { id: Number(fd.get("id")) }, include: { level: true } });
    await renumberFunnel(stage.level.funnelId);
    return done("Tahapan dihapus.");
  });
}

export async function moveStage(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    const stage = await db.funnelStage.findUniqueOrThrow({ where: { id: Number(fd.get("id")) }, include: { level: true } });
    const dir = str(fd, "dir") === "up" ? -1 : 1;
    const neighbor = await db.funnelStage.findFirst({ where: { levelId: stage.levelId, order: stage.order + dir } });
    if (neighbor) {
      await db.$transaction([
        db.funnelStage.update({ where: { id: stage.id }, data: { order: neighbor.order } }),
        db.funnelStage.update({ where: { id: neighbor.id }, data: { order: stage.order } }),
      ]);
      await renumberFunnel(stage.level.funnelId);
    }
    return done("Urutan diperbarui.");
  });
}

export async function addLabel(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    await db.label.create({ data: { name: required(fd, "name", "Nama label"), color: str(fd, "color") || "#22c55e" } });
    return done("Label ditambahkan.");
  });
}

export async function deleteLabel(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    await db.label.delete({ where: { id: Number(fd.get("id")) } });
    return done("Label dihapus.");
  });
}
