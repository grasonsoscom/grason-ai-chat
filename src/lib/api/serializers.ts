// Stable JSON shapes for the public API. Never return password hashes, token
// hashes, webhook secrets (except once on create), or internal payloads.
import type { Prisma } from "@prisma/client";

export type ContactRecord = Prisma.CustomerGetPayload<{
  include: { labels: true; stage: true };
}>;

export function contactJson(contact: ContactRecord) {
  return {
    id: contact.id,
    phone: contact.phone,
    name: contact.name,
    email: contact.email,
    notes: contact.notes,
    opt_in_whatsapp: contact.optInWhatsapp,
    stage_id: contact.stageId,
    stage: contact.stage?.name ?? null,
    labels: contact.labels.map((label) => ({ id: label.id, name: label.name, color: label.color })),
    created_at: contact.createdAt.toISOString(),
    updated_at: contact.updatedAt.toISOString(),
  };
}

export type MessageRecord = Prisma.MessageGetPayload<Record<string, never>>;

export function messageJson(message: MessageRecord) {
  return {
    id: message.id,
    direction: message.direction,
    sender: message.sender,
    body: message.text,
    status: message.status,
    external_id: message.externalId,
    created_at: message.createdAt.toISOString(),
  };
}

export type ConversationRecord = Prisma.ConversationGetPayload<{
  include: { customer: true; messages: true };
}>;

export function conversationJson(conversation: ConversationRecord) {
  const last = conversation.messages[0];
  return {
    id: conversation.id,
    customer: {
      id: conversation.customer.id,
      name: conversation.customer.name,
      phone: conversation.customer.phone,
    },
    mode: conversation.mode,
    unread: conversation.unread,
    assigned_to_id: conversation.assignedToId,
    last_message_at: conversation.lastMessageAt.toISOString(),
    last_inbound_at: conversation.lastInboundAt?.toISOString() ?? null,
    last_message: last ? messageJson(last) : null,
  };
}

export type CampaignRecord = Prisma.BroadcastGetPayload<{
  include: {
    device: true;
    audience: { include: { _count: { select: { customers: true } } } };
    _count: { select: { recipients: true } };
  };
}>;

function parseTemplateIds(raw: string): number[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v) => typeof v === "number") : [];
  } catch {
    return [];
  }
}

export function campaignJson(campaign: CampaignRecord) {
  return {
    id: campaign.id,
    name: campaign.name,
    type: campaign.type,
    status: campaign.status,
    device_id: campaign.deviceId,
    device: campaign.device ? { id: campaign.device.id, label: campaign.device.label } : null,
    audience_id: campaign.audienceId,
    audience: campaign.audience ? { id: campaign.audience.id, name: campaign.audience.name } : null,
    template_ids: parseTemplateIds(campaign.message),
    audience_count: campaign.audience?._count.customers ?? null,
    recipient_count: campaign._count.recipients,
    sent_count: campaign.sentCount,
    created_at: campaign.createdAt.toISOString(),
    updated_at: campaign.updatedAt.toISOString(),
  };
}

export type ApiTokenRecord = {
  id: number;
  name: string;
  prefix: string;
  scopes: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  user?: { name: string };
};

export function apiTokenJson(token: ApiTokenRecord) {
  return {
    id: token.id,
    name: token.name,
    prefix: token.prefix,
    scopes: token.scopes,
    last_used_at: token.lastUsedAt?.toISOString() ?? null,
    expires_at: token.expiresAt?.toISOString() ?? null,
    revoked_at: token.revokedAt?.toISOString() ?? null,
    created_at: token.createdAt.toISOString(),
    ...(token.user ? { created_by: token.user.name } : {}),
  };
}

export type WebhookRecord = {
  id: number;
  name: string;
  url: string;
  secret: string;
  events: string;
  description: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  deliveries?: {
    event: string;
    statusCode: number | null;
    success: boolean;
    durationMs: number;
    createdAt: Date;
  }[];
};

export function webhookJson(webhook: WebhookRecord, includeSecret = false) {
  return {
    id: webhook.id,
    name: webhook.name,
    url: webhook.url,
    events: webhook.events ? webhook.events.split(",").filter(Boolean) : [],
    description: webhook.description,
    enabled: webhook.enabled,
    created_at: webhook.createdAt.toISOString(),
    updated_at: webhook.updatedAt.toISOString(),
    ...(includeSecret ? { secret: webhook.secret } : {}),
    ...(webhook.deliveries
      ? {
          deliveries: webhook.deliveries.map((delivery) => ({
            event: delivery.event,
            status_code: delivery.statusCode,
            success: delivery.success,
            duration_ms: delivery.durationMs,
            created_at: delivery.createdAt.toISOString(),
          })),
        }
      : {}),
  };
}
