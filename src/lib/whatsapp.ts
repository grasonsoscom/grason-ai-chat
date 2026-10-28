// WhatsApp Cloud API client. Without WHATSAPP_TOKEN and a phone number id
// (per device, or WHATSAPP_PHONE_NUMBER_ID) messages are only stored locally
// and marked "simulated". Inbound messages arrive at /api/webhooks/whatsapp.
// [TBD] Verify current Meta pricing/24h-window rules before going live.

export const GRAPH_URL = "https://graph.facebook.com/v21.0";
/** Device.apiType for numbers linked by QR (see wa-hub.ts) instead of Cloud API. */
export const HUB_API_TYPE = "WhatsApp Hub";
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The device's own phone number id wins; the env value is the single-number fallback. */
function resolvePhoneNumberId(phoneNumberId?: string | null) {
  return phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || "";
}

export function isConfigured(phoneNumberId?: string | null) {
  return Boolean(process.env.WHATSAPP_TOKEN && resolvePhoneNumberId(phoneNumberId));
}

export function insideServiceWindow(lastInboundAt: Date | null | undefined) {
  return !!lastInboundAt && Date.now() - new Date(lastInboundAt).getTime() < SERVICE_WINDOW_MS;
}

export type SendResult = { status: "sent" | "simulated" | "failed"; error?: string; externalId?: string };

type GraphResponse = { messages?: { id: string }[]; error?: { message?: string; code?: number } };

async function post(body: Record<string, unknown>, phoneNumberId?: string | null): Promise<SendResult> {
  const id = resolvePhoneNumberId(phoneNumberId);
  if (!process.env.WHATSAPP_TOKEN || !id) return { status: "simulated" };
  try {
    const res = await fetch(`${GRAPH_URL}/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
      signal: AbortSignal.timeout(15000),
    });
    const json = (await res.json().catch(() => ({}))) as GraphResponse;
    if (!res.ok) {
      const detail = json.error?.message ? `: ${json.error.message}` : "";
      return { status: "failed", error: `WhatsApp API ${res.status}${json.error?.code ? ` (${json.error.code})` : ""}${detail}` };
    }
    return { status: "sent", externalId: json.messages?.[0]?.id };
  } catch {
    return { status: "failed", error: "Tidak dapat terhubung ke WhatsApp API" };
  }
}

export function sendText(to: string, text: string, phoneNumberId?: string | null) {
  return post({ to: to.replace(/\D/g, ""), type: "text", text: { body: text } }, phoneNumberId);
}

export function sendTemplate(to: string, templateName: string, opts: { languageCode?: string; phoneNumberId?: string | null } = {}) {
  return post(
    {
      to: to.replace(/\D/g, ""),
      type: "template",
      template: { name: templateName, language: { code: opts.languageCode ?? "id" } },
    },
    opts.phoneNumberId,
  );
}

/** Marks an inbound message as read (blue ticks for the customer). Best effort. */
export async function markRead(externalId: string, phoneNumberId?: string | null) {
  await post({ status: "read", message_id: externalId }, phoneNumberId).catch(() => {});
}
