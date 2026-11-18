"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { run, str, type ActionState } from "@/lib/action";
import { cleanRecipients, MAX_ALERT_RECIPIENTS } from "@/lib/alerts";
import { addDays, clampHour, longDay, phonesOf, wibDay, wibHour } from "@/lib/lead-report";
import { sendLeadReport } from "@/lib/lead-report-data";

export async function saveLeadReport(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireAdmin();
    const raw = str(fd, "phones").split(/[\s,;]+/).filter(Boolean);
    if (raw.length > MAX_ALERT_RECIPIENTS) throw new Error(`Maksimal ${MAX_ALERT_RECIPIENTS} nomor.`);
    const phones = cleanRecipients(raw);
    if (raw.length !== phones.length) throw new Error("Ada nomor yang tidak valid. Pakai format 0812… atau 62812…");
    const enabled = fd.get("enabled") === "on";
    if (enabled && !phones.length) throw new Error("Isi minimal satu nomor WhatsApp untuk mengaktifkan kirim otomatis.");
    const hour = clampHour(Number(fd.get("hour")));
    const now = new Date();
    const yesterday = addDays(wibDay(now), -1);
    await db.account.update({
      where: { id: 1 },
      data: {
        leadReportEnabled: enabled,
        leadReportPhones: phones.join(","),
        leadReportHour: hour,
        // Turning it on after today's hour must not fire a surprise report right away.
        ...(enabled && wibHour(now) >= hour ? { leadReportLastDate: yesterday } : {}),
      },
    });
    revalidatePath("/laporan");
    return enabled
      ? `Tersimpan. Laporan lead dikirim otomatis setiap hari jam ${String(hour).padStart(2, "0")}.00 WIB ke ${phones.length} nomor.`
      : "Tersimpan. Kirim otomatis nonaktif.";
  });
}

export async function sendLeadReportNow(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireAdmin();
    const acc = await db.account.findUnique({ where: { id: 1 }, select: { leadReportPhones: true } });
    const phones = phonesOf(acc?.leadReportPhones ?? "");
    if (!phones.length) throw new Error("Simpan nomor WhatsApp tujuan dulu.");
    const today = wibDay(new Date());
    const asked = str(fd, "day");
    const day = /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today ? asked : addDays(today, -1);
    const sent = await sendLeadReport(day, phones);
    if (!sent) throw new Error("Gagal mengirim. Pastikan ada nomor WhatsApp Hub yang terhubung.");
    return `Laporan ${longDay(day)} terkirim ke ${sent} nomor.`;
  });
}
