// Routes outgoing messages to the device's channel: Cloud API or WhatsApp Hub.
// Baileys is imported lazily so serverless/CLI processes never load it unless
// a Hub-linked number is actually used.
import { HUB_API_TYPE, sendTemplate, sendText } from "./whatsapp";

type DeviceRef = { id: number; apiType: string; phoneNumberId?: string | null } | null | undefined;

export async function sendTextVia(device: DeviceRef, to: string, text: string) {
  if (device?.apiType === HUB_API_TYPE) {
    const { sendHubText } = await import("./wa-hub");
    return sendHubText(device.id, to, text);
  }
  return sendText(to, text, device?.phoneNumberId);
}

/** Hub has no Meta-approved templates, so the template body is sent as plain text. */
export async function sendTemplateVia(device: DeviceRef, to: string, tpl: { name: string; body: string }) {
  if (device?.apiType === HUB_API_TYPE) {
    const { sendHubText } = await import("./wa-hub");
    return sendHubText(device.id, to, tpl.body);
  }
  return sendTemplate(to, tpl.name, { phoneNumberId: device?.phoneNumberId });
}
