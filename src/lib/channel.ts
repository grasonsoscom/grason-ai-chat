// Routes outgoing messages to the device's channel: Cloud API or WhatsApp Hub.
// Baileys is imported lazily so serverless/CLI processes never load it unless
// a Hub-linked number is actually used.
import { HUB_API_TYPE, sendMedia, sendTemplate, sendText, sendTyping, type OutgoingMedia } from "./whatsapp";

type DeviceRef = { id: number; apiType: string; phoneNumberId?: string | null } | null | undefined;

export async function sendTextVia(device: DeviceRef, to: string, text: string) {
  if (device?.apiType === HUB_API_TYPE) {
    const { sendHubText } = await import("./wa-hub");
    return sendHubText(device.id, to, text);
  }
  return sendText(to, text, device?.phoneNumberId);
}

export async function sendMediaVia(device: DeviceRef, to: string, media: OutgoingMedia) {
  if (device?.apiType === HUB_API_TYPE) {
    const { sendHubMedia } = await import("./wa-hub");
    return sendHubMedia(device.id, to, media);
  }
  return sendMedia(to, media, device?.phoneNumberId);
}

/** "typing…" before an AI reply; needs the customer's last message id on Cloud API. */
export async function sendTypingVia(device: DeviceRef, to: string, lastInboundExternalId?: string | null) {
  if (device?.apiType === HUB_API_TYPE) {
    const { sendHubTyping } = await import("./wa-hub");
    return sendHubTyping(device.id, to);
  }
  if (lastInboundExternalId) await sendTyping(lastInboundExternalId, device?.phoneNumberId);
}

/** Hub has no Meta-approved templates, so the template body is sent as plain text. */
export async function sendTemplateVia(device: DeviceRef, to: string, tpl: { name: string; body: string }) {
  if (device?.apiType === HUB_API_TYPE) {
    const { sendHubText } = await import("./wa-hub");
    return sendHubText(device.id, to, tpl.body);
  }
  return sendTemplate(to, tpl.name, { phoneNumberId: device?.phoneNumberId });
}
