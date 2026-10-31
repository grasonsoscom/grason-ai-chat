// Delivers outbound webhooks to every enabled endpoint subscribed to an event.
// One attempt per endpoint with a 5s timeout; every attempt is logged so the
// Developer > Webhooks page can show recent deliveries.
import { randomUUID } from "node:crypto";
import type { WebhookEndpoint } from "@prisma/client";
import { db } from "../db";
import { eventMatches } from "./events";
import { signWebhook } from "./signature";

type Endpoint = Pick<WebhookEndpoint, "id" | "url" | "secret" | "events" | "enabled">;
type DeliveryResult = { success: boolean; statusCode: number | null; error: string | null };

export type WebhookDispatchResult = {
  event: string;
  eventId: string;
  delivered: number;
  failed: number;
};

export async function dispatchWebhook(
  event: string,
  data: Record<string, unknown>,
): Promise<WebhookDispatchResult> {
  // test.ping is only sent by sendTestWebhook to one endpoint.
  if (event === "test.ping") return { event, eventId: "", delivered: 0, failed: 0 };

  const endpoints = await db.webhookEndpoint.findMany({ where: { enabled: true } });
  const matching = endpoints.filter((endpoint) => eventMatches(endpoint.events, event));
  if (!matching.length) return { event, eventId: "", delivered: 0, failed: 0 };

  const eventId = randomUUID();
  const raw = JSON.stringify({
    event,
    event_id: eventId,
    sent_at: new Date().toISOString(),
    data,
  });

  const results = await Promise.allSettled(
    matching.map((endpoint) => deliverOne(endpoint, event, eventId, raw)),
  );
  const delivered = results.filter(
    (result) => result.status === "fulfilled" && result.value.success,
  ).length;

  return { event, eventId, delivered, failed: results.length - delivered };
}

async function deliverOne(
  endpoint: Endpoint,
  event: string,
  eventId: string,
  raw: string,
): Promise<DeliveryResult> {
  const started = Date.now();
  const timestamp = Math.floor(Date.now() / 1000);
  let statusCode: number | null = null;
  let error: string | null = null;

  try {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Event": event,
        "X-Webhook-Signature": signWebhook(endpoint.secret, timestamp, raw),
        "Idempotency-Key": eventId,
        "User-Agent": "GrasOn-Webhooks/1.0",
      },
      body: raw,
      signal: AbortSignal.timeout(5000),
    });
    statusCode = response.status;
    if (!response.ok) error = `HTTP ${response.status}`;
  } catch (e) {
    error = (e as Error).message;
  }

  const durationMs = Date.now() - started;
  await db.webhookDelivery
    .create({
      data: {
        endpointId: endpoint.id,
        event,
        eventId,
        statusCode,
        success: !error,
        durationMs,
        error,
      },
    })
    .catch((e) => console.error("[webhook] failed to log delivery:", (e as Error).message));

  return { success: !error, statusCode, error };
}

/** Send test.ping to one endpoint, regardless of its subscriptions. */
export async function sendTestWebhook(endpointId: number) {
  const endpoint = await db.webhookEndpoint.findUnique({ where: { id: endpointId } });
  if (!endpoint) throw new Error("Webhook tidak ditemukan.");
  const eventId = randomUUID();
  const raw = JSON.stringify({
    event: "test.ping",
    event_id: eventId,
    sent_at: new Date().toISOString(),
    data: { message: "Tes dari GrasOn AI Chat" },
  });
  return deliverOne(endpoint, "test.ping", eventId, raw);
}
