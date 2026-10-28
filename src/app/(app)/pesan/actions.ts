"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { optId, required, run, str, type ActionState } from "@/lib/action";
import { aiRespond, recordInbound, sendStaffMessage, sendTemplateMessage } from "@/lib/messaging";

export async function sendMessage(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    const id = Number(fd.get("conversationId"));
    const templateId = optId(fd, "templateId");
    if (templateId) await sendTemplateMessage(id, templateId);
    else await sendStaffMessage(id, required(fd, "text", "Pesan"));
    revalidatePath("/pesan");
    return "Pesan terkirim.";
  });
}

export async function updateConversation(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    const id = Number(fd.get("conversationId"));
    const mode = str(fd, "mode");
    if (!["ai", "staf", "eskalasi"].includes(mode)) throw new Error("Mode tidak valid.");
    const conv = await db.conversation.update({
      where: { id },
      data: { mode, assignedToId: optId(fd, "assignedToId") },
    });
    await db.customer.update({ where: { id: conv.customerId }, data: { stageId: optId(fd, "stageId") } });
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
