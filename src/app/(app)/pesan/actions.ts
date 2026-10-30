"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { num, optId, required, run, str, type ActionState } from "@/lib/action";
import { formatIDR } from "@/lib/format";
import { aiRespond, recordInbound, sendStaffMessage, sendTemplateMessage } from "@/lib/messaging";
import { createOmsCheckout, omsHandover, verifyOmsCheckout } from "@/lib/oms-sync";
import { codQuote, customerSegment, regionFromText } from "@/lib/promo";

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
    // Decided: only escalation is an OMS handover; turning the AI off is not.
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

const ORDER_LINES = [1, 2, 3];

/**
 * Staff form "Buat Order OMS": sends the checkout to OMS with the COD breakdown from
 * codQuote. A checkout that failed before is reused, so a retry keeps its external_id.
 */
export async function createOmsOrder(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    const id = Number(fd.get("conversationId"));
    const conv = await db.conversation.findUniqueOrThrow({ where: { id } });
    const method = str(fd, "method") === "transfer" ? "transfer" : "cod";

    const lines = ORDER_LINES.map((i) => ({ variantId: optId(fd, `variant${i}`), qty: num(fd, `qty${i}`) })).filter((l) => l.variantId);
    if (!lines.length) throw new Error("Pilih minimal satu produk.");
    const variants = await db.productVariant.findMany({ where: { id: { in: lines.map((l) => l.variantId!) } }, include: { product: true } });
    const qtyBySku = new Map<string, number>();
    let price = 0;
    for (const l of lines) {
      const v = variants.find((x) => x.id === l.variantId);
      if (!v) throw new Error("Produk tidak ditemukan.");
      if (!v.sku.trim()) throw new Error(`${v.product.name} ${v.name} belum punya SKU. Isi SKU di halaman Produk.`);
      if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > 100) throw new Error("Jumlah per produk harus 1 sampai 100.");
      qtyBySku.set(v.sku.trim(), (qtyBySku.get(v.sku.trim()) ?? 0) + l.qty);
      price += (v.salePrice ?? v.price) * l.qty;
    }

    const ongkir = num(fd, "ongkir");
    if (!Number.isInteger(ongkir) || ongkir < 0) throw new Error("Ongkir harus angka rupiah tanpa desimal.");
    const phone = required(fd, "recipientPhone", "No. WA penerima").replace(/[\s-]/g, "");
    if (!/^\+?\d{8,15}$/.test(phone)) throw new Error("No. WA penerima tidak valid.");
    const kodePos = str(fd, "kodePos");
    if (kodePos && !/^\d{5}$/.test(kodePos)) throw new Error("Kode pos harus 5 angka.");
    const provinsi = required(fd, "provinsi", "Provinsi");

    let quote;
    if (method === "cod") {
      const region = regionFromText(provinsi);
      if (!region) throw new Error("Provinsi tidak dikenali. Tulis nama provinsi, mis. Jawa Barat.");
      quote = codQuote(price, ongkir, await customerSegment(conv.customerId), region);
    }

    const retry = await db.omsCheckout.findFirst({ where: { conversationId: id, orderGroupId: null }, orderBy: { id: "desc" } });
    const checkout = retry ?? (await db.omsCheckout.create({ data: { conversationId: id, externalId: `pending-${id}-${Date.now()}` } }));
    const externalId = `checkout-${checkout.id}`;
    if (checkout.externalId !== externalId) await db.omsCheckout.update({ where: { id: checkout.id }, data: { externalId } });

    const result = await createOmsCheckout(id, {
      externalId,
      method,
      recipient: { name: required(fd, "recipientName", "Nama penerima"), phone },
      address: {
        alamat: required(fd, "alamat", "Alamat"),
        ...(str(fd, "kelurahan") ? { kelurahan: str(fd, "kelurahan") } : {}),
        ...(str(fd, "kecamatan") ? { kecamatan: str(fd, "kecamatan") } : {}),
        kota: required(fd, "kota", "Kota/kabupaten"),
        provinsi,
        ...(kodePos ? { kode_pos: kodePos } : {}),
      },
      items: [...qtyBySku].map(([sku, qty]) => ({ sku, qty })),
      price,
      ongkir,
      quote,
      notes: str(fd, "catatan") || undefined,
    });
    revalidatePath("/pesan");
    const total = result.orders.reduce((s, o) => s + o.total, 0);
    return `Order dibuat di OMS: ${result.orders.map((o) => o.nomor).join(", ")}. Total ${formatIDR(total)}.`;
  });
}

/** "Verifikasi COD": the buyer confirmed address, COD amount and willingness to pay. */
export async function verifyOmsOrder(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    await verifyOmsCheckout(required(fd, "externalId", "Checkout"), new Date());
    revalidatePath("/pesan");
    return "Order terverifikasi di OMS.";
  });
}
