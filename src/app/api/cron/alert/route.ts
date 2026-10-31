import { timingSafeEqual } from "node:crypto";
import { alertAdmin } from "@/lib/alerts";

function sameSecret(given: string | null, expected: string) {
  const a = Buffer.from(given ?? "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Alerts from the VPS watchdog (deploy/grason-watchdog.sh), e.g. "the app was
 * restarted". POST with x-webhook-secret and { key, text }.
 */
export async function POST(req: Request) {
  const secret = process.env.INCOMING_WEBHOOK_SECRET;
  if (!secret || !sameSecret(req.headers.get("x-webhook-secret"), secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { key?: unknown; text?: unknown };
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 1000) : "";
  if (!text) return Response.json({ error: "text wajib diisi." }, { status: 400 });
  const key = typeof body.key === "string" && body.key ? `watchdog:${body.key.slice(0, 50)}` : "watchdog";
  // The watchdog throttles itself; send every alert it asks for.
  await alertAdmin(key, text, 0);
  return Response.json({ ok: true });
}
