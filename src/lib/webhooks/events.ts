// Outbound webhook event catalogue. An endpoint with no events receives all
// subscribable events; test.ping is only sent by the UI test action.

export type WebhookEvent = {
  key: string;
  group: string;
  label: string;
  description: string;
  subscribable: boolean;
};

export const WEBHOOK_EVENTS: WebhookEvent[] = [
  { key: "contact.created", group: "Contacts", label: "Kontak dibuat", description: "A contact was created", subscribable: true },
  { key: "contact.updated", group: "Contacts", label: "Kontak diubah", description: "A contact was edited", subscribable: true },
  { key: "message.received", group: "Messages", label: "Pesan masuk", description: "An inbound message was received", subscribable: true },
  { key: "message.sent", group: "Messages", label: "Pesan keluar", description: "An outbound message was sent", subscribable: true },
  { key: "message.status", group: "Messages", label: "Status pesan", description: "A message was delivered, read or failed", subscribable: true },
  { key: "conversation.created", group: "Conversations", label: "Percakapan dibuat", description: "A conversation was started", subscribable: true },
  { key: "conversation.status_changed", group: "Conversations", label: "Status percakapan", description: "A conversation mode was changed", subscribable: true },
  { key: "conversation.escalated", group: "Conversations", label: "Eskalasi", description: "A conversation was escalated to staff", subscribable: true },
  { key: "campaign.started", group: "Campaigns", label: "Campaign dimulai", description: "A campaign started sending", subscribable: true },
  { key: "campaign.completed", group: "Campaigns", label: "Campaign selesai", description: "A campaign finished sending", subscribable: true },
  { key: "ai.replied", group: "AI", label: "AI membalas", description: "An AI agent sent a reply", subscribable: true },
  { key: "test.ping", group: "Test", label: "Tes", description: "Only sent by the Send test action", subscribable: false },
];

export const WEBHOOK_EVENT_KEYS = WEBHOOK_EVENTS.map((event) => event.key);

export function parseWebhookEvents(raw: string): string[] {
  return raw
    .split(",")
    .map((event) => event.trim())
    .filter(Boolean);
}

/** Empty subscription means every event. */
export function eventMatches(subscription: string, event: string): boolean {
  const events = parseWebhookEvents(subscription);
  return events.length === 0 || events.includes(event);
}

export function webhookEventGroups() {
  const groups = new Map<string, WebhookEvent[]>();
  for (const event of WEBHOOK_EVENTS) {
    if (!event.subscribable) continue;
    const list = groups.get(event.group) ?? [];
    list.push(event);
    groups.set(event.group, list);
  }
  return [...groups.entries()].map(([group, events]) => ({ group, events }));
}
