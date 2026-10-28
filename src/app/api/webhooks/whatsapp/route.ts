import { after } from "next/server";
import { handleWebhook, verifySignature, type WebhookPayload } from "@/lib/wa-cloud";

/** Meta's one-time subscription check when the callback URL is saved in the App Dashboard. */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (token && p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === token) {
    return new Response(p.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

/**
 * Message and status events. Answers 200 right away and processes after the
 * response, because Meta retries slow deliveries (AI replies can take seconds).
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!process.env.WHATSAPP_APP_SECRET) {
    console.error("[wa-cloud] WHATSAPP_APP_SECRET is not set; rejecting webhook");
    return new Response("Not configured", { status: 500 });
  }
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) {
    return new Response("Invalid signature", { status: 401 });
  }
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  after(() => handleWebhook(payload).catch((e) => console.error("[wa-cloud] webhook failed:", (e as Error).message)));
  return new Response("EVENT_RECEIVED", { status: 200 });
}
