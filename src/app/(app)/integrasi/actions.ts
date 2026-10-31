"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { run, str, type ActionState } from "@/lib/action";
import { importShippingWorkbook } from "@/lib/shipping-import";
import { saveAiSettings, type AiProvider } from "@/lib/ai-settings";
import { saveRajaOngkirSettings } from "@/lib/rajaongkir";
import { getOmsCatalog } from "@/lib/oms/catalog";
import { omsConfigured } from "@/lib/oms/client";

const MAX_RATE_FILE = 10 * 1024 * 1024;

export async function saveAi(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireAdmin();
    const provider = str(fd, "aiProvider") as AiProvider;
    await saveAiSettings({
      provider,
      baseUrl: str(fd, "aiBaseUrl"),
      model: str(fd, "aiModel"),
      apiKey: str(fd, "aiApiKey") || undefined,
    });
    revalidatePath("/integrasi");
    return "Pengaturan AI disimpan. Balasan AI berikutnya memakai pengaturan baru.";
  });
}

export async function saveRajaOngkir(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireAdmin();
    await saveRajaOngkirSettings({
      apiKey: str(fd, "rajaOngkirApiKey") || undefined,
      originId: Number(fd.get("originId")),
      originLabel: str(fd, "originLabel"),
      courier: str(fd, "courier"),
      weight: Number(fd.get("weight")),
    });
    revalidatePath("/integrasi");
    revalidatePath("/ongkir");
    return "Pengaturan RajaOngkir disimpan.";
  });
}

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

export async function testOmsConnection(_: ActionState, __: FormData) {
  return run(async () => {
    await requireAdmin();
    if (!omsConfigured()) {
      throw new Error("OMS belum dikonfigurasi. Isi OMS_BASE_URL dan OMS_API_KEY di environment.");
    }
    const started = Date.now();
    const catalog = await getOmsCatalog({ force: true });
    if (!catalog) {
      throw new Error("Tidak dapat mengambil katalog dari OMS. Cek OMS_BASE_URL, API key, dan koneksi.");
    }
    return `Terhubung ke OMS. ${catalog.prices.length} harga dan ${catalog.stock.length} stok, ${Date.now() - started} ms.`;
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
