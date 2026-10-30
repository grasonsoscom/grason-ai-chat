"use server";

import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { SESSION_COOKIE, signSession } from "@/lib/session";
import type { ActionState } from "@/lib/action";

export async function login(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const user = await db.user.findUnique({ where: { email } });
  if (user && !user.passwordHash) return { error: "Akun ini belum punya kata sandi. Klik Masuk dengan Google.", at: Date.now() };
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return { error: "Email atau kata sandi salah.", at: Date.now() };
  }
  if (user.status !== "active") return { error: "Akun Anda tidak aktif.", at: Date.now() };
  (await cookies()).set(SESSION_COOKIE, await signSession(user.id), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 7 * 86400,
  });
  redirect("/pesan");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
