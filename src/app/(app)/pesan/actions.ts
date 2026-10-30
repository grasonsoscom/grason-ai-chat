"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { optId, required, run, str, type ActionState } from "@/lib/action";
import { aiRespond, recordInbound, sendStaffMessage, sendTemplateMessage } from "@/lib/messaging";
import { omsHandover } from "@/lib/oms-sync";

export async function sendMessage(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    const id = Number(fd.get("conversationId"));
    const templateId = optId(fd, "templateId");
    const conv = await db.conversation.findUniqueOrThrow({ where: { id } });
    if (conv.mode === "ai") throw new Error("Agen AI sedang aktif. Matikan Agen AI untuk membalas manual.");
    if (templateId) await sendTemplateMessage(id, templateId);
    else await sendStaffMessage(id, required(fd, "text", "Pesan"));
    revalidatePath("/pesan");
    return "Pesan terkirim.";
  });
}

export async function updateConversation(_: ActionState, fd: FormData) {
  return run(async () => {
    const me = await requireUser();
    const id = Number(fd.get("conversationId"));
    const mode = str(fd, "mode");
    if (!["ai", "staf", "eskalasi"].includes(mode)) throw new Error("Mode tidak valid.");
    const before = await db.conversation.findUniqueOrThrow({ where: { id } });
    const conv = await db.conversation.update({
      where: { id },
      data: { mode, assignedToId: optId(fd, "assignedToId"), ...(before.mode !== mode ? { modeChangedAt: new Date() } : {}) },
    });
    await db.customer.update({ where: { id: conv.customerId }, data: { stageId: optId(fd, "stageId") } });
    // TODO(product): should switching to "staf" (AI off) also count as an OMS handover?
    if (before.mode !== "eskalasi" && mode === "eskalasi") await omsHandover(id, `Dieskalasi manual oleh ${me.name}`);
    revalidatePath("/pesan");
    return "Percakapan diperbarui.";
  });
}

export async function requestAiReply(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    const status = await aiRespond(Number(fd.get("conversationId")));
    revalidatePath("/pesan");
    const messages: Record<string, string> = {
      replied: "AI sudah membalas.",
      escalated: "Percakapan dieskalasi ke staf.",
      no_agent: "Belum ada AI Agent yang ditugaskan ke perangkat ini.",
      error: "AI gagal membalas. Lihat catatan di percakapan.",
    };
    if (status === "no_agent") throw new Error(messages.no_agent);
    return messages[status] ?? "Selesai.";
  });
}

/** Testing helper: injects an inbound message as if it came from WhatsApp. */
export async function simulateInbound(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    await recordInbound({
      phone: required(fd, "phone", "Nomor"),
      name: str(fd, "name"),
      text: required(fd, "text", "Pesan"),
      deviceId: optId(fd, "deviceId"),
    });
    revalidatePath("/pesan");
    return "Pesan masuk disimulasikan.";
  });
}

/** Agen AI switch in the chat room: on = AI replies, off = staff reply. */
export async function setAiMode(conversationId: number, on: boolean): Promise<{ error?: string }> {
  try {
    const me = await requireUser();
    const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    const mode = on ? "ai" : "staf";
    if (conv.mode !== mode) {
      await db.conversation.update({ where: { id: conversationId }, data: { mode, modeChangedAt: new Date() } });
      await db.message.create({
        data: { conversationId, direction: "out", sender: "system", status: "sent", text: on ? `Agen AI dinyalakan oleh ${me.name}.` : `Agen AI dimatikan oleh ${me.name}. Staf membalas manual.` },
      });
    }
    revalidatePath("/pesan");
    return {};
  } catch (e) {
    return { error: (e as Error).message || "Gagal mengubah Agen AI." };
  }
}
