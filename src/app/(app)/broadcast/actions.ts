"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertCoins, COIN_COSTS, spendCoins } from "@/lib/coins";
import { sendTemplateVia } from "@/lib/channel";
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
    await db.broadcast.create({
      data: { name: required(fd, "name", "Nama broadcast"), type, deviceId, audienceId, createdById: user.id, message: JSON.stringify(templateIds) },
    });
    revalidatePath("/broadcast");
    return "Broadcast disimpan sebagai draft.";
  });
}

export async function sendBroadcast(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    const b = await db.broadcast.findUniqueOrThrow({ where: { id: Number(fd.get("id")) }, include: { device: true, audience: { include: { customers: true } } } });
    if (b.status === "Terkirim") throw new Error("Broadcast ini sudah dikirim.");
    if (!b.audience || b.audience.customers.length === 0) throw new Error("Audiens kosong atau sudah dihapus.");
    const templateIds: number[] = JSON.parse(b.message);
    const templates = await db.messageTemplate.findMany({ where: { id: { in: templateIds } } });
    const ordered = templateIds.map((id) => templates.find((t) => t.id === id)).filter((t) => !!t);
    if (ordered.length === 0) throw new Error("Template broadcast sudah dihapus.");

    const total = b.audience.customers.length * ordered.length;
    const cost = total * COIN_COSTS.broadcastMessage;
    await assertCoins(cost);

    let sent = 0;
    for (const c of b.audience.customers) {
      const conv = await db.conversation.upsert({ where: { customerId: c.id }, update: {}, create: { customerId: c.id, deviceId: b.deviceId } });
      for (const t of ordered) {
        const res = await sendTemplateVia(b.device, c.phone, t);
        await db.message.create({ data: { conversationId: conv.id, direction: "out", sender: "staff", text: `[Broadcast: ${t.name}] ${t.body}`, status: res.status, externalId: res.externalId } });
        if (res.status !== "failed") sent++;
      }
      await db.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } });
    }
    await spendCoins(sent * COIN_COSTS.broadcastMessage, `Broadcast "${b.name}" (${sent} pesan)`);
    await db.broadcast.update({ where: { id: b.id }, data: { status: sent === total ? "Terkirim" : sent ? "Sebagian" : "Gagal", sentCount: sent } });
    revalidatePath("/broadcast");
    return `${sent} dari ${total} pesan terkirim.`;
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
