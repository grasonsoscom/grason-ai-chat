"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { generateReply, type ChatTurn } from "@/lib/ai";
import { assertCoins, COIN_COSTS, spendCoins } from "@/lib/coins";
import { runFollowups } from "@/lib/messaging";
import { num, optId, required, run, str, type ActionState } from "@/lib/action";
import type { Prisma } from "@prisma/client";

export async function createAgent() {
  await requireAdmin();
  const a = await db.aiAgent.create({ data: { name: "Agen baru" } });
  redirect(`/ai-agent/${a.id}`);
}

export async function deleteAgent(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireAdmin();
    await db.aiAgent.delete({ where: { id: Number(fd.get("id")) } });
    revalidatePath("/ai-agent");
    return "AI Agent dihapus.";
  });
}

/** Saves only the section that was submitted, so tabs don't overwrite each other. */
export async function saveAgent(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireAdmin();
    const id = Number(fd.get("id"));
    const section = str(fd, "section");
    const on = (k: string) => fd.get(k) === "on";
    const ids = (k: string) => fd.getAll(k).map(Number).filter(Boolean).map((v) => ({ id: v }));
    let data: Prisma.AiAgentUpdateInput;
    switch (section) {
      case "informasi":
        data = { name: required(fd, "name", "Nama agen"), description: str(fd, "description"), baseLearning: str(fd, "baseLearning") || "Customer Service" };
        break;
      case "kepribadian":
        data = { personality: str(fd, "personality") };
        break;
      case "produk":
        data = { products: { set: ids("productIds") } };
        break;
      case "pengaturan": {
        const max = num(fd, "maxReplyChars");
        if (max < 50 || max > 4000) throw new Error("Panjang balasan harus antara 50 dan 4000 karakter.");
        data = { active: on("active"), maxReplyChars: max };
        break;
      }
      case "eskalasi":
        data = { escalationEnabled: on("escalationEnabled"), escalationKeywords: str(fd, "escalationKeywords"), escalationMessage: str(fd, "escalationMessage") };
        break;
      case "penugasan":
        data = { devices: { set: ids("deviceIds") } };
        break;
      case "funnels": {
        const funnelId = optId(fd, "funnelId");
        data = { funnel: funnelId ? { connect: { id: funnelId } } : { disconnect: true } };
        break;
      }
      case "followup": {
        const hours = num(fd, "followupDelayHours");
        if (hours < 1 || hours > 23) throw new Error("Jeda follow-up harus 1 sampai 23 jam agar masih di dalam jendela 24 jam WhatsApp.");
        data = { followupEnabled: on("followupEnabled"), followupDelayHours: hours, followupMessage: str(fd, "followupMessage") };
        break;
      }
      case "integrasi":
        data = { webhookOnReply: on("webhookOnReply") };
        break;
      default:
        throw new Error("Bagian tidak dikenal.");
    }
    await db.aiAgent.update({ where: { id }, data });
    revalidatePath(`/ai-agent/${id}`);
    revalidatePath("/ai-agent");
    return "Perubahan disimpan.";
  });
}

export async function testAgentReply(agentId: number, turns: ChatTurn[], overrides?: { description?: string; personality?: string }) {
  await requireUser();
  try {
    await assertCoins(COIN_COSTS.aiReply);
    const reply = await generateReply(agentId, turns, overrides);
    await spendCoins(COIN_COSTS.aiReply, "AI Response Test");
    return { reply };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function triggerFollowups(_: ActionState, __: FormData) {
  return run(async () => {
    await requireAdmin();
    const sent = await runFollowups();
    return `${sent} follow-up terkirim.`;
  });
}
