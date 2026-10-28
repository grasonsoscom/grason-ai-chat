// Routes outgoing messages to the device's channel: Cloud API or WhatsApp Hub.
import { sendHubText } from "./wa-hub";
import { HUB_API_TYPE, sendTemplate, sendText } from "./whatsapp";

type DeviceRef = { id: number; apiType: string; phoneNumberId?: string | null } | null | undefined;

export function sendTextVia(device: DeviceRef, to: string, text: string) {
  return device?.apiType === HUB_API_TYPE ? sendHubText(device.id, to, text) : sendText(to, text, device?.phoneNumberId);
}

/** Hub has no Meta-approved templates, so the template body is sent as plain text. */
export function sendTemplateVia(device: DeviceRef, to: string, tpl: { name: string; body: string }) {
  return device?.apiType === HUB_API_TYPE
    ? sendHubText(device.id, to, tpl.body)
    : sendTemplate(to, tpl.name, { phoneNumberId: device?.phoneNumberId });
}
