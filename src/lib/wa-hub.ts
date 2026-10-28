// WhatsApp Hub: numbers linked by scanning a QR (WhatsApp Web-style, via the
// unofficial Baileys client). Sessions stay connected so inbound messages flow
// into Pesan and replies go out through the linked number.
// Server-only: live sockets are held in memory (single long-running Node process).
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { DisconnectReason, jidDecode, type proto } from "baileys";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { disconnectCode, openSocket, type WASocket } from "@/lib/baileys";
import { HUB_API_TYPE, type SendResult } from "@/lib/whatsapp";

const HUB_DIR = path.resolve(process.env.WA_HUB_DIR || ".wa-hub");
const PAIRING_TTL_MS = 3 * 60 * 1000;

type Session = {
  key: string;
  label: string;
  deviceId: number | null; // null while pairing
  sock: WASocket | null;
  qr: string | null;
  state: "pairing" | "connecting" | "open" | "error";
  error?: string;
  retries: number;
  stopped: boolean;
  createdAt: number;
};

// Survives dev hot reloads.
const g = globalThis as unknown as { __waHub?: { sessions: Map<string, Session>; restored: boolean } };
const hub = (g.__waHub ??= { sessions: new Map(), restored: false });

const dirOf = (key: string) => path.join(HUB_DIR, key);
const findByDevice = (deviceId: number) => [...hub.sessions.values()].find((s) => s.deviceId === deviceId && !s.stopped);

async function logEvent(deviceId: number, message: string) {
  await db.deviceEvent.create({ data: { deviceId, message } }).catch(() => {});
}

function stop(s: Session) {
  s.stopped = true;
  try { s.sock?.end(undefined); } catch {}
}

async function connect(s: Session) {
  if (s.stopped) return;
  const sock = await openSocket(dirOf(s.key));
  s.sock = sock;
  sock.ev.on("connection.update", (u) => void onUpdate(s, sock, u).catch(() => {}));
  sock.ev.on("messages.upsert", (e) => void onMessages(s, e).catch(() => {}));
}

async function onUpdate(s: Session, sock: WASocket, u: { qr?: string; connection?: string; lastDisconnect?: { error?: unknown } }) {
  if (s.stopped || s.sock !== sock) return;

  if (u.qr) {
    // A linked session asking for a QR means its credentials are no longer valid.
    if (s.deviceId != null) return loggedOut(s);
    s.qr = u.qr;
  }

  if (u.connection === "open") {
    s.retries = 0;
    s.qr = null;
    s.state = "open";
    if (s.deviceId == null) return linkDevice(s, sock);
    const d = await db.device.findUnique({ where: { id: s.deviceId } });
    if (!d) return stop(s);
    if (d.status !== "connected") {
      await db.device.update({ where: { id: d.id }, data: { status: "connected", connectedAt: new Date() } });
      await logEvent(d.id, "Tersambung kembali ke WhatsApp Hub");
    }
    return;
  }

  if (u.connection === "close") {
    const code = disconnectCode(u.lastDisconnect?.error);
    // WhatsApp asks for one reconnect right after a successful scan.
    if (code === DisconnectReason.restartRequired) return connect(s);
    if (code === DisconnectReason.loggedOut) return loggedOut(s);

    if (s.deviceId == null) {
      s.state = "error";
      s.error = code === DisconnectReason.timedOut ? "Kode QR kedaluwarsa. Coba lagi." : "Koneksi ke WhatsApp terputus. Coba lagi.";
      stop(s);
      await rm(dirOf(s.key), { recursive: true, force: true }).catch(() => {});
      return;
    }

    s.state = "connecting";
    const d = await db.device.findUnique({ where: { id: s.deviceId } });
    if (!d) return stop(s);
    if (d.status === "connected") {
      await db.device.update({ where: { id: d.id }, data: { status: "disconnected" } });
      await logEvent(d.id, "Koneksi WhatsApp Hub terputus, mencoba menyambung ulang");
    }
    const delay = Math.min(60_000, 2000 * 2 ** s.retries++);
    setTimeout(() => void connect(s).catch(() => {}), delay);
  }
}

/** First successful scan: create the Hub device (or re-link the one with the same number). */
async function linkDevice(s: Session, sock: WASocket) {
  const digits = jidDecode(sock.user?.id)?.user ?? "";
  if (!digits) {
    s.state = "error";
    s.error = "Nomor WhatsApp tidak terbaca. Coba lagi.";
    await sock.logout().catch(() => {});
    return stop(s);
  }
  const phone = `+${digits}`;
  const existing = await db.device.findFirst({ where: { apiType: HUB_API_TYPE, phone } });
  let deviceId: number;
  if (existing) {
    const old = findByDevice(existing.id);
    if (old && old !== s) stop(old);
    if (existing.hubSessionKey && existing.hubSessionKey !== s.key) {
      await rm(dirOf(existing.hubSessionKey), { recursive: true, force: true }).catch(() => {});
    }
    await db.device.update({ where: { id: existing.id }, data: { hubSessionKey: s.key, status: "connected", connectedAt: new Date() } });
    deviceId = existing.id;
    await logEvent(deviceId, "Nomor ditautkan ulang lewat scan QR");
  } else {
    const d = await db.device.create({
      data: {
        label: s.label, phone, apiType: HUB_API_TYPE, coex: false, status: "connected", hubSessionKey: s.key,
        events: { create: { message: "Nomor ditautkan lewat scan QR (WhatsApp Hub)" } },
      },
    });
    deviceId = d.id;
  }
  s.deviceId = deviceId;
}

async function loggedOut(s: Session) {
  stop(s);
  hub.sessions.delete(s.key);
  await rm(dirOf(s.key), { recursive: true, force: true }).catch(() => {});
  if (s.deviceId == null) {
    s.state = "error";
    s.error = "Gagal menautkan nomor. Coba lagi.";
    return;
  }
  await db.device.update({ where: { id: s.deviceId }, data: { status: "disconnected", hubSessionKey: null } }).catch(() => {});
  await logEvent(s.deviceId, "Perangkat dilepas dari WhatsApp. Scan ulang untuk menghubungkan.");
}

function messageText(m: proto.IMessage | null | undefined): string {
  if (!m) return "";
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.ephemeralMessage?.message?.conversation ??
    m.ephemeralMessage?.message?.extendedTextMessage?.text ??
    ""
  ).trim();
}

async function onMessages(s: Session, e: { type: string; messages: proto.IWebMessageInfo[] }) {
  if (e.type !== "notify" || s.deviceId == null) return;
  const { recordInbound } = await import("./messaging");
  for (const m of e.messages) {
    if (m.key?.fromMe) continue;
    // Newer WhatsApp may address chats by LID; the phone JID is then in the "Alt" field.
    const key = m.key as { remoteJid?: string; remoteJidAlt?: string };
    const jid = [key.remoteJid, key.remoteJidAlt].find((j) => j?.endsWith("@s.whatsapp.net"));
    const digits = jidDecode(jid)?.user;
    if (!digits) continue; // groups, broadcasts, status, or LID-only contacts
    const text = messageText(m.message);
    if (!text) continue; // only text messages are supported for now
    await recordInbound({ phone: `+${digits}`, name: m.pushName ?? undefined, text, deviceId: s.deviceId });
  }
}

function sweep() {
  const now = Date.now();
  for (const s of hub.sessions.values()) {
    if (s.deviceId == null && now - s.createdAt > PAIRING_TTL_MS) {
      stop(s);
      hub.sessions.delete(s.key);
      if (s.state !== "error") void rm(dirOf(s.key), { recursive: true, force: true }).catch(() => {});
    }
  }
}

/** Starts a QR pairing; returns a key for polling. */
export async function startPairing(label: string) {
  sweep();
  const s: Session = {
    key: randomBytes(16).toString("hex"), label, deviceId: null, sock: null, qr: null,
    state: "pairing", retries: 0, stopped: false, createdAt: Date.now(),
  };
  hub.sessions.set(s.key, s);
  await connect(s).catch(() => {
    s.state = "error";
    s.error = "Gagal terhubung ke WhatsApp.";
  });
  return s.key;
}

export async function getPairing(key: string) {
  sweep();
  const s = hub.sessions.get(key);
  if (!s) return { state: "error" as const, error: "Sesi scan kedaluwarsa. Coba lagi." };
  if (s.state === "error") return { state: "error" as const, error: s.error ?? "Terjadi kesalahan." };
  if (s.deviceId != null) return { state: "connected" as const };
  return { state: "pending" as const, qr: s.qr ? await QRCode.toDataURL(s.qr, { margin: 1, width: 264 }) : null };
}

export async function cancelPairing(key: string) {
  const s = hub.sessions.get(key);
  if (!s || s.deviceId != null) return;
  stop(s);
  hub.sessions.delete(key);
  await rm(dirOf(key), { recursive: true, force: true }).catch(() => {});
}

/** Unlinks the number from WhatsApp and deletes the stored session. */
export async function disconnectHubDevice(deviceId: number) {
  const s = findByDevice(deviceId);
  if (s) {
    s.stopped = true;
    await s.sock?.logout().catch(() => {});
    try { s.sock?.end(undefined); } catch {}
    hub.sessions.delete(s.key);
  }
  const d = await db.device.findUnique({ where: { id: deviceId } });
  if (d?.hubSessionKey) await rm(dirOf(d.hubSessionKey), { recursive: true, force: true }).catch(() => {});
  if (d) await db.device.update({ where: { id: deviceId }, data: { status: "disconnected", hubSessionKey: null } });
}

export async function sendHubText(deviceId: number, to: string, text: string): Promise<SendResult> {
  const s = findByDevice(deviceId);
  if (!s?.sock || s.state !== "open") return { status: "failed", error: "Perangkat WhatsApp Hub tidak terhubung. Scan ulang di menu WhatsApp Hub." };
  try {
    await s.sock.sendMessage(`${to.replace(/\D/g, "")}@s.whatsapp.net`, { text });
    return { status: "sent" };
  } catch {
    return { status: "failed", error: "Pesan gagal dikirim lewat WhatsApp Hub." };
  }
}

/** Reconnects every saved Hub session. Called once at server start. */
export async function restoreHubSessions() {
  if (hub.restored) return;
  hub.restored = true;
  const devices = await db.device.findMany({ where: { apiType: HUB_API_TYPE, hubSessionKey: { not: null } } });
  for (const d of devices) {
    const key = d.hubSessionKey!;
    if (!existsSync(dirOf(key))) {
      await db.device.update({ where: { id: d.id }, data: { status: "disconnected", hubSessionKey: null } });
      continue;
    }
    const s: Session = {
      key, label: d.label, deviceId: d.id, sock: null, qr: null,
      state: "connecting", retries: 0, stopped: false, createdAt: Date.now(),
    };
    hub.sessions.set(key, s);
    void connect(s).catch(() => {});
  }
}
