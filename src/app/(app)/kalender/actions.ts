"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { optId, required, run, str, type ActionState } from "@/lib/action";

export async function saveEvent(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    const date = new Date(`${required(fd, "date", "Tanggal")}T${str(fd, "time") || "09:00"}:00+07:00`);
    if (isNaN(date.getTime())) throw new Error("Tanggal tidak valid.");
    await db.calendarEvent.create({
      data: {
        title: required(fd, "title", "Judul"), date, notes: str(fd, "notes"),
        staffId: optId(fd, "staffId"), customerId: optId(fd, "customerId"),
      },
    });
    revalidatePath("/kalender");
    return "Jadwal ditambahkan.";
  });
}

export async function deleteEvent(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireUser();
    await db.calendarEvent.delete({ where: { id: Number(fd.get("id")) } });
    revalidatePath("/kalender");
    return "Jadwal dihapus.";
  });
}
