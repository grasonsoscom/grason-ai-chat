"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { required, run, str, type ActionState } from "@/lib/action";
import { FULL_ACCESS, normalizeScopes } from "@/lib/api/scopes";
import { generateApiToken } from "@/lib/api/tokens";

export async function createToken(_: ActionState, fd: FormData) {
  return run(async () => {
    const user = await requireAdmin();
    const name = required(fd, "name", "Nama token");
    const fullAccess = fd.get("fullAccess") === "on";
    const scopes = fullAccess
      ? [FULL_ACCESS]
      : normalizeScopes(fd.getAll("scopes").map(String));
    if (scopes.length === 0) throw new Error("Pilih minimal satu scope.");

    const expiresRaw = str(fd, "expires_at");
    let expiresAt: Date | null = null;
    if (expiresRaw) {
      const parsed = new Date(`${expiresRaw}T23:59:59.999Z`);
      if (Number.isNaN(parsed.getTime())) throw new Error("Tanggal kedaluwarsa tidak valid.");
      if (parsed.getTime() <= Date.now()) throw new Error("Tanggal kedaluwarsa harus di masa depan.");
      expiresAt = parsed;
    }

    const generated = generateApiToken();
    await db.apiToken.create({
      data: {
        name,
        prefix: generated.prefix,
        tokenHash: generated.tokenHash,
        scopes: scopes.join(","),
        userId: user.id,
        expiresAt,
      },
    });
    revalidatePath("/developer/api-tokens");
    // Returned once; the UI shows a copy panel.
    return generated.token;
  });
}

export async function revokeToken(_: ActionState, fd: FormData) {
  return run(async () => {
    await requireAdmin();
    const id = Number(fd.get("id"));
    const token = await db.apiToken.findUnique({ where: { id } });
    if (!token) throw new Error("Token tidak ditemukan.");
    if (token.revokedAt) return "Token sudah dicabut.";
    await db.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
    revalidatePath("/developer/api-tokens");
    return "Token dicabut. Aplikasi yang memakainya akan langsung gagal.";
  });
}
