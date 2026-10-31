"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { optId, required, run, str, type ActionState } from "@/lib/action";
import { emitWebhook } from "@/lib/webhook";

export async function saveCustomer(_: ActionState, fd: FormData) {
  return run(async () => {
    await requirePermission("pelanggan");
    const id = optId(fd, "id");
    const labelIds = fd.getAll("labelIds").map(Number).filter(Boolean);
    const optInRaw = fd.get("optInWhatsapp");
    const data = {
      name: required(fd, "name", "Nama"),
      phone: required(fd, "phone", "Nomor telepon"),
      email: str(fd, "email"),
      notes: str(fd, "notes"),
      stageId: optId(fd, "stageId"),
      segment: ["nc", "ro", "reseller"].includes(str(fd, "segment")) ? str(fd, "segment") : "",
      ...(optInRaw === null ? {} : { optInWhatsapp: optInRaw === "on" }),
    };
    if (!/^\+?\d{8,15}$/.test(data.phone.replace(/[\s-]/g, ""))) throw new Error("Format nomor telepon tidak valid.");
    data.phone = data.phone.replace(/[\s-]/g, "");
    let customerId = id;
    if (id) {
      await db.customer.update({ where: { id }, data: { ...data, labels: { set: labelIds.map((l) => ({ id: l })) } } });
    } else {
      const customer = await db.customer.create({ data: { ...data, labels: { connect: labelIds.map((l) => ({ id: l })) } } });
      customerId = customer.id;
    }
    await emitWebhook(id ? "contact.updated" : "contact.created", {
      contact: { id: customerId, name: data.name, phone: data.phone, email: data.email },
    });
    revalidatePath("/pelanggan");
    return id ? "Pelanggan diperbarui." : "Pelanggan ditambahkan.";
  });
}

export async function deleteCustomer(_: ActionState, fd: FormData) {
  return run(async () => {
    await requirePermission("pelanggan");
    await db.customer.delete({ where: { id: Number(fd.get("id")) } });
    revalidatePath("/pelanggan");
    return "Pelanggan dihapus.";
  });
}
