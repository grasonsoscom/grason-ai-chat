import { Prisma } from "@prisma/client";

export type ActionState = { error?: string; ok?: string; at?: number } | null;

/** Wraps a server action body so failures surface as a readable Indonesian message. */
export async function run(fn: () => Promise<string | void>): Promise<ActionState> {
  try {
    const ok = await fn();
    return { ok: ok || "Berhasil disimpan.", at: Date.now() };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "Data dengan nilai yang sama sudah ada.", at: Date.now() };
    }
    return { error: (e as Error).message || "Terjadi kesalahan.", at: Date.now() };
  }
}

export function str(fd: FormData, key: string) {
  return String(fd.get(key) ?? "").trim();
}

export function required(fd: FormData, key: string, label: string) {
  const v = str(fd, key);
  if (!v) throw new Error(`${label} wajib diisi.`);
  return v;
}

export function num(fd: FormData, key: string) {
  const v = Number(fd.get(key));
  return Number.isFinite(v) ? v : 0;
}

export function optId(fd: FormData, key: string) {
  const v = Number(fd.get(key));
  return v > 0 ? v : null;
}
