import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";
import { SESSION_COOKIE, verifySession } from "./session";

export async function getCurrentUser() {
  const store = await cookies();
  const uid = await verifySession(store.get(SESSION_COOKIE)?.value);
  if (!uid) return null;
  const user = await db.user.findUnique({ where: { id: uid }, include: { role: true } });
  if (!user || user.status !== "active") return null;
  return user;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role.name !== "Admin") throw new Error("Hanya Admin yang dapat melakukan aksi ini.");
  return user;
}
