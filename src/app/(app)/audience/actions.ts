"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { required, run, type ActionState } from "@/lib/action";

export async function createAudience(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    const ids = fd.getAll("customerIds").map(Number).filter(Boolean);
    if (ids.length === 0) throw new Error("Pilih minimal satu pelanggan.");
    await db.audience.create({ data: { name: required(fd, "name", "Nama audiens"), type: "Manual", customers: { connect: ids.map((id) => ({ id })) } } });
    revalidatePath("/audience");
    return "Audiens dibuat.";
  });
}

function parseCsv(text: string) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error("File kosong. Gunakan format dari contoh (nama,telepon,email).");
  const sep = lines[0].includes(";") ? ";" : ",";
  const head = lines[0].toLowerCase().split(sep).map((h) => h.trim());
  const iName = head.indexOf("nama"), iPhone = head.indexOf("telepon"), iEmail = head.indexOf("email");
  if (iName < 0 || iPhone < 0) throw new Error("Kolom wajib: nama, telepon.");
  return lines.slice(1).map((l, n) => {
    const cols = l.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
    const phone = (cols[iPhone] ?? "").replace(/[\s-]/g, "");
    if (!/^\+?\d{8,15}$/.test(phone)) throw new Error(`Baris ${n + 2}: nomor telepon tidak valid.`);
    return { name: cols[iName] || phone, phone, email: iEmail >= 0 ? cols[iEmail] ?? "" : "" };
  });
}

export async function importAudience(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Pilih file CSV.");
    if (file.size > 5 * 1024 * 1024) throw new Error("File maksimal 5 MB.");
    const rows = parseCsv(await file.text());
    const ids: number[] = [];
    for (const r of rows) {
      const c = await db.customer.upsert({ where: { phone: r.phone }, update: {}, create: r });
      ids.push(c.id);
    }
    await db.audience.create({
      data: { name: required(fd, "name", "Nama audiens"), type: "Impor", customers: { connect: ids.map((id) => ({ id })) } },
    });
    revalidatePath("/audience");
    revalidatePath("/pelanggan");
    return `${rows.length} pelanggan diimpor.`;
  });
}

export async function deleteAudience(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    await db.audience.delete({ where: { id: Number(fd.get("id")) } });
    revalidatePath("/audience");
    return "Audiens dihapus.";
  });
}
