import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { readMedia } from "@/lib/media";

/** Testimonial file preview for logged-in staff (may show customers' faces or chats). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return new Response("Not found", { status: 404 });
  const m = await db.mediaAsset.findUnique({ where: { id } });
  if (!m) return new Response("Not found", { status: 404 });
  try {
    const data = await readMedia(m.fileName);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": m.mimeType,
        "Content-Length": String(data.length),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
