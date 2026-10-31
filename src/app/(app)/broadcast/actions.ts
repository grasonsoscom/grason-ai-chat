"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { createCampaign, launchCampaign } from "@/lib/campaigns";
import { optId, required, run, type ActionState } from "@/lib/action";

export async function createBroadcast(_: ActionState, fd: FormData) {
  return run(async () => {
    const user = await requireUser();
    const type = fd.get("type") === "Series" ? "Series" : "Single";
    const templateIds = fd.getAll("templateIds").map(Number).filter(Boolean);
    if (templateIds.length === 0) throw new Error("Pilih minimal satu template pesan.");
    if (type === "Single" && templateIds.length > 1) throw new Error("Broadcast Single hanya memakai satu template.");
    const deviceId = optId(fd, "deviceId");
    const audienceId = optId(fd, "audienceId");
    if (!deviceId) throw new Error("Pilih perangkat.");
    if (!audienceId) throw new Error("Pilih audiens.");

    await createCampaign({
      name: required(fd, "name", "Nama broadcast"),
      type,
      deviceId,
      audienceId,
      templateIds,
      createdById: user.id,
    });
    revalidatePath("/broadcast");
    return "Broadcast disimpan sebagai draft.";
  });
}

export async function sendBroadcast(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    // The UI keeps the historical "resend a partially failed broadcast" behavior.
    const result = await launchCampaign(Number(fd.get("id")), { allowResend: true });
    revalidatePath("/broadcast");
    return `${result.sent} dari ${result.total} pesan terkirim (status ${result.status}).`;
  });
}

export async function deleteBroadcast(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    await db.broadcast.delete({ where: { id: Number(fd.get("id")) } });
    revalidatePath("/broadcast");
    return "Broadcast dihapus.";
  });
}
