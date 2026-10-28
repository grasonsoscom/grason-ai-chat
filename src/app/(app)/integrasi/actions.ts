"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { run, str, type ActionState } from "@/lib/action";
import { emitWebhook } from "@/lib/webhook";
import { importShippingWorkbook } from "@/lib/shipping-import";

export async function saveWebhook(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireAdmin();
    const url = str(fd, "webhookUrl");
    const enabled = fd.get("webhookEnabled") === "on";
    if (url && !/^https?:\/\//.test(url)) throw new Error("URL harus diawali http:// atau https://");
    if (enabled && !url) throw new Error("Isi URL webhook untuk mengaktifkan.");
    await db.account.update({ where: { id: 1 }, data: { webhookUrl: url || null, webhookEnabled: enabled } });
    revalidatePath("/integrasi");
    return "Pengaturan webhook disimpan.";
  });
}

export async function testWebhook(_: ActionState, __: FormData) {
  return run(async () => {
    await requireAdmin();
    await emitWebhook("test", { message: "Tes dari GrasOn AI Chat" });
    return "Event tes dikirim (cek log server jika tidak diterima).";
  });
}

const MAX_RATE_FILE = 10 * 1024 * 1024;

export async function importShipping(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireAdmin();
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) throw new Error("Pilih file Excel (.xlsx) dulu.");
    if (!/\.xlsx$/i.test(file.name)) throw new Error("Format file harus .xlsx.");
    if (file.size > MAX_RATE_FILE) throw new Error("Ukuran file maksimal 10 MB.");
    const { reg, cargo } = await importShippingWorkbook(await file.arrayBuffer(), file.name);
    revalidatePath("/integrasi");
    return `Tarif diimpor: ${reg.toLocaleString("id-ID")} tarif REG dan ${cargo.toLocaleString("id-ID")} tarif Cargo.`;
  });
}

export async function saveScalev(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireAdmin();
    const key = str(fd, "scalevApiKey");
    await db.account.update({
      where: { id: 1 },
      // Empty field keeps the stored key so it never has to be shown back.
      data: { scalevEnabled: fd.get("scalevEnabled") === "on", ...(key ? { scalevApiKey: key } : {}) },
    });
    revalidatePath("/integrasi");
    return "Pengaturan Scalev disimpan.";
  });
}
