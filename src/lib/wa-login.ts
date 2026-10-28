// Login by linking WhatsApp (WhatsApp Web-style QR) via Baileys, an unofficial
// client. The linked session is used only to read the scanner's own number,
// then logged out immediately so Centris keeps no access to the account.
// Server-only: holds live sockets in memory (single Node process).
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DisconnectReason, jidDecode } from "baileys";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { disconnectCode, openSocket, type WASocket } from "@/lib/baileys";

export const WA_LOGIN_COOKIE = "centris_wa_login";
const ATTEMPT_TTL_MS = 3 * 60 * 1000;

export type AttemptStatus =
  | { state: "pending"; qr: string | null }
  | { state: "approved"; userId: number }
  | { state: "error"; error: string };

type Attempt = { status: AttemptStatus; createdAt: number; cleanup: () => Promise<void> };

// Survives dev hot reloads.
const g = globalThis as unknown as { __waLogin?: Map<string, Attempt> };
const attempts = (g.__waLogin ??= new Map());

/** Digits only, Indonesian local "08…" normalized to "628…". */
export function normalizePhone(phone: string) {
  const d = phone.replace(/\D/g, "");
  return d.startsWith("0") ? `62${d.slice(1)}` : d;
}

async function findUserByPhone(digits: string) {
  // Phone is free text in the Staff form, so compare normalized digits.
  const users = await db.user.findMany({ where: { phone: { not: "" } }, select: { id: true, phone: true, status: true } });
  return users.find((u) => normalizePhone(u.phone) === digits) ?? null;
}

function sweep() {
  const now = Date.now();
  for (const [id, a] of attempts) {
    if (now - a.createdAt > ATTEMPT_TTL_MS) {
      attempts.delete(id);
      void a.cleanup();
    }
  }
}

export async function startAttempt(): Promise<string> {
  sweep();
  const id = randomBytes(24).toString("base64url");
  const dir = await mkdtemp(path.join(tmpdir(), "centris-wa-"));
  let sock: WASocket | null = null;
  let done = false;

  const attempt: Attempt = {
    status: { state: "pending", qr: null },
    createdAt: Date.now(),
    cleanup: async () => {
      done = true;
      try { sock?.end(undefined); } catch {}
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    },
  };
  attempts.set(id, attempt);

  const fail = (error: string) => {
    if (done) return;
    attempt.status = { state: "error", error };
    void attempt.cleanup();
  };

  const connect = async () => {
    const s = await openSocket(dir);
    sock = s;
    s.ev.on("connection.update", async (u) => {
      if (done) return;
      if (u.qr && attempt.status.state === "pending") attempt.status = { state: "pending", qr: u.qr };

      if (u.connection === "open") {
        const digits = jidDecode(s.user?.id)?.user ?? "";
        // Unlink right away; we only needed to confirm the number.
        await s.logout().catch(() => {});
        const user = digits ? await findUserByPhone(digits) : null;
        if (!user) return fail("Nomor WhatsApp ini tidak terdaftar sebagai staf.");
        if (user.status !== "active") return fail("Akun Anda tidak aktif.");
        attempt.status = { state: "approved", userId: user.id };
        done = true;
        await rm(dir, { recursive: true, force: true }).catch(() => {});
        return;
      }

      if (u.connection === "close") {
        const code = disconnectCode(u.lastDisconnect?.error);
        // After a successful scan WhatsApp asks the client to reconnect once.
        if (code === DisconnectReason.restartRequired) return void connect().catch(() => fail("Gagal terhubung ke WhatsApp."));
        if (code === DisconnectReason.timedOut) return fail("Kode QR kedaluwarsa. Muat ulang untuk mencoba lagi.");
        fail("Koneksi ke WhatsApp terputus. Muat ulang untuk mencoba lagi.");
      }
    });
  };

  await connect().catch(() => fail("Gagal terhubung ke WhatsApp."));
  return id;
}

/** Status for the login page. QR is returned as a data URL. */
export async function getAttempt(id: string | undefined) {
  sweep();
  const a = id ? attempts.get(id) : undefined;
  if (!a) return { state: "error" as const, error: "Sesi login kedaluwarsa. Muat ulang kode QR." };
  if (a.status.state === "pending") {
    return { state: "pending" as const, qr: a.status.qr ? await QRCode.toDataURL(a.status.qr, { margin: 1, width: 264 }) : null };
  }
  if (a.status.state === "approved") return { state: "approved" as const };
  return a.status;
}

/** One-time: returns the user id for an approved attempt and forgets it. */
export function consumeApproved(id: string | undefined) {
  const a = id ? attempts.get(id) : undefined;
  if (!a || a.status.state !== "approved") return null;
  attempts.delete(id!);
  return a.status.userId;
}

export async function cancelAttempt(id: string | undefined) {
  const a = id ? attempts.get(id) : undefined;
  if (!a) return;
  attempts.delete(id!);
  await a.cleanup();
}
