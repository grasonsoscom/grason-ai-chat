"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { optId, required, run, str, type ActionState } from "@/lib/action";

const done = (msg: string) => { revalidatePath("/staff"); return msg; };

export async function saveStaff(_: ActionState, fd: FormData) {
  return run(async () => {
    const me = await requireAdmin();
    const id = optId(fd, "id");
    const password = str(fd, "password");
    if (password && password.length < 8) throw new Error("Kata sandi minimal 8 karakter.");
    const status = str(fd, "status") === "inactive" ? "inactive" : "active";
    if (id === me.id && status === "inactive") throw new Error("Anda tidak dapat menonaktifkan akun sendiri.");
    const data = {
      name: required(fd, "name", "Nama"),
      email: required(fd, "email", "Email").toLowerCase(),
      phone: str(fd, "phone"),
      roleId: Number(fd.get("roleId")),
      groupId: optId(fd, "groupId"),
      status,
      ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}),
    };
    if (id) {
      const before = await db.user.findUniqueOrThrow({ where: { id } });
      // A new email means a different Google account; drop the old link.
      await db.user.update({ where: { id }, data: { ...data, ...(before.email !== data.email ? { googleId: null } : {}) } });
    }
    // No password: the staff member signs in with Google using this email.
    else await db.user.create({ data: { ...data, passwordHash: data.passwordHash ?? "" } });
    return done(id ? "Staf diperbarui." : "Staf ditambahkan.");
  });
}

export async function deleteStaff(_: ActionState, fd: FormData) {
  return run(async () => {
    const me = await requireAdmin();
    const id = Number(fd.get("id"));
    if (id === me.id) throw new Error("Anda tidak dapat menghapus akun sendiri.");
    await db.user.delete({ where: { id } });
    return done("Staf dihapus.");
  });
}

export async function saveGroup(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireAdmin();
    await db.group.create({ data: { name: required(fd, "name", "Nama grup") } });
    return done("Grup ditambahkan.");
  });
}

export async function deleteGroup(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireAdmin();
    await db.group.delete({ where: { id: Number(fd.get("id")) } });
    return done("Grup dihapus.");
  });
}

export async function saveRole(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireAdmin();
    const id = optId(fd, "id");
    const data = { name: required(fd, "name", "Nama peran"), description: str(fd, "description"), permissions: fd.getAll("permissions").join(",") };
    if (id) {
      const role = await db.role.findUniqueOrThrow({ where: { id } });
      if (role.name === "Admin" && data.name !== "Admin") throw new Error("Peran Admin tidak dapat diganti namanya.");
      await db.role.update({ where: { id }, data: role.name === "Admin" ? { description: data.description } : data });
    } else await db.role.create({ data });
    return done("Peran disimpan.");
  });
}

export async function deleteRole(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireAdmin();
    const role = await db.role.findUniqueOrThrow({ where: { id: Number(fd.get("id")) }, include: { _count: { select: { users: true } } } });
    if (role.name === "Admin") throw new Error("Peran Admin tidak dapat dihapus.");
    if (role._count.users > 0) throw new Error("Peran masih dipakai oleh staf.");
    await db.role.delete({ where: { id: role.id } });
    return done("Peran dihapus.");
  });
}

