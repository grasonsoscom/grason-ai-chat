import { db } from "./db";

/** Fire-and-forget POST to the configured outgoing webhook. Never throws. */
export async function emitWebhook(event: string, data: Record<string, unknown>) {
  const acc = await db.account.findUnique({ where: { id: 1 } });
  if (!acc?.webhookEnabled || !acc.webhookUrl) return;
  try {
    await fetch(acc.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, data, sentAt: new Date().toISOString() }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    console.error(`[webhook] failed to deliver ${event}:`, (e as Error).message);
  }
}
