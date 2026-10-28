"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { run, str, type ActionState } from "@/lib/action";
import { emitWebhook } from "@/lib/webhook";

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
