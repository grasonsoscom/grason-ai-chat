import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { del, put } from "@vercel/blob";

export const UPLOAD_DIR = path.join(process.cwd(), "uploads");
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png" };

function sniff(buf: Buffer) {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return null;
}

/** Validates (JPEG/PNG, max 2 MB, checked by content) and stores an image. */
export async function saveImage(file: File) {
  if (file.size > MAX_IMAGE_BYTES) throw new Error(`"${file.name}" melebihi batas 2 MB.`);
  const buf = Buffer.from(await file.arrayBuffer());
  const type = sniff(buf);
  if (!type || !TYPES[type]) throw new Error(`"${file.name}" bukan JPEG atau PNG.`);
  const name = `${randomUUID()}${TYPES[type]}`;
  if (useBlob()) {
    // Serverless disks are ephemeral; Vercel Blob keeps the file. fileName stores its URL.
    const blob = await put(`products/${name}`, buf, { access: "public", contentType: type, addRandomSuffix: false });
    return { fileName: blob.url, mimeType: type, size: file.size };
  }
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, name), buf);
  return { fileName: name, mimeType: type, size: file.size };
}

export async function removeImage(fileName: string) {
  if (/^https?:\/\//.test(fileName)) {
    if (useBlob()) await del(fileName).catch(() => {});
    return;
  }
  await unlink(path.join(UPLOAD_DIR, path.basename(fileName))).catch(() => {});
}

/** Image src for a stored fileName (local file name or Blob URL). */
export function imageUrl(fileName: string) {
  return /^https?:\/\//.test(fileName) ? fileName : `/api/uploads/${fileName}`;
}

function useBlob() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return true;
  if (process.env.VERCEL) throw new Error("Penyimpanan gambar belum diatur. Hubungkan Vercel Blob ke project ini.");
  return false;
}
