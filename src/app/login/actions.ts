"use server";

import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { SESSION_COOKIE, signSession } from "@/lib/session";
import { WA_LOGIN_COOKIE, cancelAttempt, consumeApproved, getAttempt, startAttempt } from "@/lib/wa-login";
import type { ActionState } from "@/lib/action";

async function setSession(userId: number) {
  (await cookies()).set(SESSION_COOKIE, await signSession(userId), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 7 * 86400,
  });
}

/** Email + password login, kept alongside WhatsApp QR as a fallback. */
export async function login(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const user = await db.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return { error: "Email atau kata sandi salah.", at: Date.now() };
  }
  if (user.status !== "active") return { error: "Akun Anda tidak aktif.", at: Date.now() };
  await setSession(user.id);
  redirect("/pesan");
}

// The attempt id lives in an httpOnly cookie, so only the browser that
// showed the QR can claim the login.

export async function startWaLogin() {
  const store = await cookies();
  await cancelAttempt(store.get(WA_LOGIN_COOKIE)?.value);
  const id = await startAttempt();
  store.set(WA_LOGIN_COOKIE, id, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/login", maxAge: 5 * 60,
  });
}

export async function pollWaLogin() {
  return getAttempt((await cookies()).get(WA_LOGIN_COOKIE)?.value);
}

export async function completeWaLogin(): Promise<{ error: string } | void> {
  const store = await cookies();
  const userId = consumeApproved(store.get(WA_LOGIN_COOKIE)?.value);
  if (!userId) return { error: "Login belum disetujui. Scan ulang kode QR." };
  store.delete({ name: WA_LOGIN_COOKIE, path: "/login" });
  await setSession(userId);
  redirect("/pesan");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
