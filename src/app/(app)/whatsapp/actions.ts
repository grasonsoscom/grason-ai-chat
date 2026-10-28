"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { required, run, str, type ActionState } from "@/lib/action";
import { cancelPairing, disconnectHubDevice, getPairing, startPairing } from "@/lib/wa-hub";
import { HUB_API_TYPE } from "@/lib/whatsapp";

const done = (msg: string) => { revalidatePath("/whatsapp"); return msg; };

export async function addDevice(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireAdmin();
    const phone = required(fd, "phone", "Nomor").replace(/[\s-]/g, "");
    if (!/^\+?\d{8,15}$/.test(phone)) throw new Error("Format nomor tidak valid.");
    await db.device.create({
      data: {
        label: required(fd, "label", "Nama perangkat"), phone, coex: fd.get("coex") === "on",
        phoneNumberId: phoneNumberIdOf(fd),
        events: { create: { message: "Perangkat ditambahkan" } },
      },
    });
    return done("Perangkat ditambahkan.");
  });
}

function phoneNumberIdOf(fd: FormData) {
  const v = str(fd, "phoneNumberId");
  if (v && !/^\d{6,20}$/.test(v)) throw new Error("Phone Number ID hanya berisi angka (lihat WhatsApp Manager > API Setup).");
  return v || null;
}

export async function saveCloudConfig(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireAdmin();
    const id = Number(fd.get("deviceId"));
    await db.device.update({ where: { id }, data: { phoneNumberId: phoneNumberIdOf(fd) } });
    await db.deviceEvent.create({ data: { deviceId: id, message: "Pengaturan Cloud API diperbarui" } });
    return done("Pengaturan Cloud API disimpan.");
  });
}

export async function assignStaff(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireAdmin();
    const id = Number(fd.get("deviceId"));
    const ids = fd.getAll("staffIds").map(Number).filter(Boolean);
    await db.device.update({ where: { id }, data: { staff: { set: ids.map((s) => ({ id: s })) } } });
    await db.deviceEvent.create({ data: { deviceId: id, message: `Penugasan staf diperbarui (${ids.length} staf)` } });
    return done("Penugasan staf disimpan.");
  });
}

export async function setDeviceStatus(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireAdmin();
    const id = Number(fd.get("deviceId"));
    const status = str(fd, "status") === "connected" ? "connected" : "disconnected";
    await db.device.update({ where: { id }, data: { status, ...(status === "connected" ? { connectedAt: new Date() } : {}) } });
    await db.deviceEvent.create({ data: { deviceId: id, message: status === "connected" ? "Perangkat terhubung" : "Perangkat diputus" } });
    return done("Status diperbarui.");
  });
}

export async function addTemplate(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireAdmin();
    const name = required(fd, "name", "Nama template").toLowerCase();
    if (!/^[a-z0-9_]+$/.test(name)) throw new Error("Nama template hanya boleh huruf kecil, angka, dan garis bawah.");
    const deviceId = Number(fd.get("deviceId"));
    await db.messageTemplate.create({ data: { deviceId, name, category: str(fd, "category") || "UTILITY", body: required(fd, "body", "Isi template") } });
    await db.deviceEvent.create({ data: { deviceId, message: `Template "${name}" ditambahkan` } });
    return done("Template ditambahkan.");
  });
}

export async function deleteTemplate(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireAdmin();
    await db.messageTemplate.delete({ where: { id: Number(fd.get("id")) } });
    return done("Template dihapus.");
  });
}

export async function deleteDevice(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireAdmin();
    const id = Number(fd.get("id"));
    const d = await db.device.findUniqueOrThrow({ where: { id } });
    if (d.apiType === HUB_API_TYPE) await disconnectHubDevice(id);
    await db.device.delete({ where: { id } });
    return done("Perangkat dihapus.");
  });
}

// WhatsApp Hub (QR-linked numbers)

export async function startHubPairing(label: string) {
  await requireAdmin();
  const name = label.trim();
  if (!name) return { error: "Nama perangkat wajib diisi." };
  return { key: await startPairing(name) };
}

export async function pollHubPairing(key: string) {
  await requireAdmin();
  const s = await getPairing(key);
  if (s.state === "connected") revalidatePath("/whatsapp");
  return s;
}

export async function cancelHubPairing(key: string) {
  await requireAdmin();
  await cancelPairing(key);
}

export async function disconnectHub(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireAdmin();
    const id = Number(fd.get("deviceId"));
    await disconnectHubDevice(id);
    await db.deviceEvent.create({ data: { deviceId: id, message: "Perangkat diputus dan dilepas dari WhatsApp" } });
    return done("Perangkat diputus.");
  });
}
