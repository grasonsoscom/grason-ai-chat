// Testimonial media library: photos/videos the AI agent or staff send in chat.
// Files live under uploads/media (or Vercel Blob when configured); the type is
// checked from the file content, not the name.
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { del, put } from "@vercel/blob";
import { UPLOAD_DIR } from "./uploads";

export const MEDIA_DIR = path.join(UPLOAD_DIR, "media");
/** Same limit as product images (CLAUDE.md). */
export const MAX_MEDIA_IMAGE_BYTES = 2 * 1024 * 1024;
/** WhatsApp's video limit. */
export const MAX_MEDIA_VIDEO_BYTES = 16 * 1024 * 1024;
/** At most this many media per AI reply. */
export const MAX_MEDIA_PER_REPLY = 2;

export type MediaKind = "image" | "video";

const EXT: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "video/mp4": ".mp4" };
export const KIND_LABEL: Record<MediaKind, string> = { image: "Foto", video: "Video" };

/** JPEG, PNG, or MP4 (ISO base media with an "ftyp" box), else null. */
export function sniffMedia(buf: Buffer): { mimeType: string; kind: MediaKind } | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mimeType: "image/jpeg", kind: "image" };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: "image/png", kind: "image" };
  }
  if (buf.length >= 12 && buf.subarray(4, 8).toString("latin1") === "ftyp") {
    // QuickTime (.mov) is not accepted by WhatsApp; MP4 brands only.
    const brand = buf.subarray(8, 12).toString("latin1");
    if (brand !== "qt  ") return { mimeType: "video/mp4", kind: "video" };
  }
  return null;
}

/** Validates a file and returns its type, or throws a message for the user. */
export function checkMedia(name: string, buf: Buffer) {
  const type = sniffMedia(buf);
  if (!type) throw new Error(`"${name}" bukan foto JPEG/PNG atau video MP4.`);
  const max = type.kind === "image" ? MAX_MEDIA_IMAGE_BYTES : MAX_MEDIA_VIDEO_BYTES;
  if (buf.length > max) {
    throw new Error(`"${name}" melebihi batas ${type.kind === "image" ? "2 MB untuk foto" : "16 MB untuk video"}.`);
  }
  return type;
}

export async function saveMedia(file: File) {
  const buf = Buffer.from(await file.arrayBuffer());
  const type = checkMedia(file.name, buf);
  const name = `${randomUUID()}${EXT[type.mimeType]}`;
  if (useBlob()) {
    const blob = await put(`media/${name}`, buf, { access: "public", contentType: type.mimeType, addRandomSuffix: false });
    return { fileName: blob.url, mimeType: type.mimeType, kind: type.kind, size: buf.length };
  }
  await mkdir(MEDIA_DIR, { recursive: true });
  await writeFile(path.join(MEDIA_DIR, name), buf);
  return { fileName: name, mimeType: type.mimeType, kind: type.kind, size: buf.length };
}

export async function readMedia(fileName: string): Promise<Buffer> {
  if (/^https?:\/\//.test(fileName)) {
    const res = await fetch(fileName, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error("File media tidak dapat diambil.");
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(path.join(MEDIA_DIR, path.basename(fileName)));
}

export async function removeMedia(fileName: string) {
  if (/^https?:\/\//.test(fileName)) {
    if (useBlob()) await del(fileName).catch(() => {});
    return;
  }
  await unlink(path.join(MEDIA_DIR, path.basename(fileName))).catch(() => {});
}

/** Preview URL for logged-in staff. */
export const mediaUrl = (id: number) => `/api/media/${id}`;

function useBlob() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return true;
  if (process.env.VERCEL) throw new Error("Penyimpanan media belum diatur. Hubungkan Vercel Blob ke project ini.");
  return false;
}

const TAG = /\[\[\s*media\s*:\s*(\d+)\s*\]\]/gi;

/**
 * Splits the media tags the AI wrote ([[media:12]]) out of its reply. Every tag
 * is removed from the text; only ids in `allowed` are kept, once each, up to
 * MAX_MEDIA_PER_REPLY.
 */
export function splitMediaTags(reply: string, allowed: Iterable<number>) {
  const izin = new Set(allowed);
  const ids: number[] = [];
  for (const m of reply.matchAll(TAG)) {
    const id = Number(m[1]);
    if (izin.has(id) && !ids.includes(id) && ids.length < MAX_MEDIA_PER_REPLY) ids.push(id);
  }
  const text = reply
    .replace(TAG, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return { text, ids };
}

export type MediaForPrompt = { id: number; title: string; kind: string; usage: string; product?: string | null };

/**
 * System prompt section listing the media the AI may send (no files, just
 * titles and when to use them).
 */
export function mediaPrompt(media: MediaForPrompt[]) {
  if (!media.length) return null;
  const list = media
    .map((m) => {
      const jenis = KIND_LABEL[m.kind as MediaKind] ?? "Media";
      const produk = m.product ? ` (produk: ${m.product})` : "";
      const kapan = m.usage.trim() ? ` – kirim bila: ${m.usage.trim()}` : "";
      return `- [[media:${m.id}]] ${jenis} "${m.title}"${produk}${kapan}`;
    })
    .join("\n");
  return [
    "Kamu bisa mengirim foto/video testimoni dari daftar di bawah. Tulis kodenya persis (mis. [[media:12]]) di balasanmu; " +
      "sistem mengirim filenya setelah teks dan kode itu tidak terlihat pelanggan.",
    `Kirim hanya bila pelanggan meminta testimoni, bukti, hasil, foto, atau video, atau ragu dan bukti akan membantu. ` +
      `Paling banyak ${MAX_MEDIA_PER_REPLY} media per balasan, pilih yang paling sesuai dengan produk yang dibahas. ` +
      "Media yang sudah pernah dikirim di percakapan ini tidak ada di daftar, jangan dikirim ulang. " +
      "Jangan mengarang testimoni, foto, atau video yang tidak ada di daftar; kalau tidak ada yang cocok, jangan janjikan akan dikirim.",
    `Media yang tersedia:\n${list}`,
  ].join("\n");
}
