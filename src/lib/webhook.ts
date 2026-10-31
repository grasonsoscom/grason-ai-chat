// Outgoing webhook entry point. Delivery details live in src/lib/webhooks/.
// Kept as a thin wrapper so existing call sites do not import the dispatcher.
import { dispatchWebhook } from "./webhooks/dispatch";

/** Fire-and-forget semantics: never throws into the messaging path. */
export async function emitWebhook(event: string, data: Record<string, unknown>) {
  try {
    await dispatchWebhook(event, data);
  } catch (e) {
    console.error(`[webhook] failed to dispatch ${event}:`, (e as Error).message);
  }
}
