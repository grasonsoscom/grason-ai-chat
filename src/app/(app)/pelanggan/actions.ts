"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { optId, required, run, str, type ActionState } from "@/lib/action";

export async function saveCustomer(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    const id = optId(fd, "id");
    const labelIds = fd.getAll("labelIds").map(Number).filter(Boolean);
    const data = {
      name: required(fd, "name", "Nama"),
      phone: required(fd, "phone", "Nomor telepon"),
      email: str(fd, "email"),
      notes: str(fd, "notes"),
      stageId: optId(fd, "stageId"),
      segment: ["nc", "ro", "reseller"].includes(str(fd, "segment")) ? str(fd, "segment") : "",
    };
    if (!/^\+?\d{8,15}$/.test(data.phone.replace(/[\s-]/g, ""))) throw new Error("Format nomor telepon tidak valid.");
    data.phone = data.phone.replace(/[\s-]/g, "");
    if (id) {
      await db.customer.update({ where: { id }, data: { ...data, labels: { set: labelIds.map((l) => ({ id: l })) } } });
    } else {
      await db.customer.create({ data: { ...data, labels: { connect: labelIds.map((l) => ({ id: l })) } } });
    }
    revalidatePath("/pelanggan");
    return id ? "Pelanggan diperbarui." : "Pelanggan ditambahkan.";
  });
}

export async function deleteCustomer(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    await db.customer.delete({ where: { id: Number(fd.get("id")) } });
    revalidatePath("/pelanggan");
    return "Pelanggan dihapus.";
  });
}
