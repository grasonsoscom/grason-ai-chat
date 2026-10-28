import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

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
  await mkdir(UPLOAD_DIR, { recursive: true });
  const fileName = `${randomUUID()}${TYPES[type]}`;
  await writeFile(path.join(UPLOAD_DIR, fileName), buf);
  return { fileName, mimeType: type, size: file.size };
}

export async function removeImage(fileName: string) {
  await unlink(path.join(UPLOAD_DIR, path.basename(fileName))).catch(() => {});
}
