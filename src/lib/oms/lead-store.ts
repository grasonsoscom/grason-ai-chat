// Local mapping between a conversation and its OMS lead. This is the only
// module that creates a lead for a conversation; callers go through ensureLead.
import { db } from "../db";
import { customerSegment } from "../promo";
import { createLead } from "./client";
import { leadExternalId, normalizePhone } from "./normalize";
import type { Kanal, Lead, LeadBaru } from "./types";

export type AttributionInput = {
  kanal?: string;
  campaign_id?: string | null;
  adset_id?: string | null;
  ad_id?: string | null;
  referral?: unknown;
};

const KANAL: ReadonlySet<string> = new Set(["click_to_whatsapp", "landing_page", "organik", "lainnya"]);

function validKanal(value: string | null | undefined): Kanal | undefined {
  return value && KANAL.has(value) ? (value as Kanal) : undefined;
}

/** Stores ad attribution on the conversation; used by POST /leads later. */
export async function storeAttribution(conversationId: number, input: AttributionInput) {
  const kanal = validKanal(input.kanal);
  await db.conversation.update({
    where: { id: conversationId },
    data: {
      ...(kanal ? { omsKanal: kanal } : {}),
      ...(input.campaign_id !== undefined ? { omsCampaignId: input.campaign_id } : {}),
      ...(input.adset_id !== undefined ? { omsAdsetId: input.adset_id } : {}),
      ...(input.ad_id !== undefined ? { omsAdId: input.ad_id } : {}),
      ...(input.referral !== undefined ? { omsReferral: JSON.stringify(input.referral) } : {}),
    },
  });
}

export async function buildLeadInput(conversationId: number): Promise<LeadBaru> {
  const conv = await db.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: { customer: true },
  });
  const firstInbound = await db.message.findFirst({
    where: { conversationId, direction: "in" },
    orderBy: { createdAt: "asc" },
  });
  const masukAt = firstInbound?.createdAt ?? conv.customer.createdAt;
  const name = conv.customer.name.trim();
  const nama = name && name !== conv.customer.phone ? name : undefined;

  return {
    external_id: leadExternalId(conversationId),
    no_wa: normalizePhone(conv.customer.phone),
    ...(nama ? { nama } : {}),
    kanal: validKanal(conv.omsKanal) ?? "organik",
    campaign_id: conv.omsCampaignId ?? null,
    adset_id: conv.omsAdsetId ?? null,
    ad_id: conv.omsAdId ?? null,
    segmen: await customerSegment(conv.customerId),
    masuk_at: masukAt.toISOString(),
  };
}

/** Returns the OMS lead id, creating the lead (idempotently) if needed. */
export async function ensureLeadId(conversationId: number): Promise<string> {
  const conv = await db.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    select: { omsLeadId: true },
  });
  if (conv.omsLeadId) return conv.omsLeadId;

  const lead = await createLead(await buildLeadInput(conversationId));
  await storeLeadSnapshot(conversationId, lead);
  return lead.id;
}

/** Mirrors the fields we care about from a Lead response. */
export async function storeLeadSnapshot(conversationId: number, lead: Lead) {
  await db.conversation.update({
    where: { id: conversationId },
    data: {
      omsLeadId: lead.id,
      omsLeadStatus: lead.status,
      ...(lead.respon_pertama_at ? { omsFirstResponseAt: new Date(lead.respon_pertama_at) } : {}),
      ...(lead.handover_at ? { omsHandoverAt: new Date(lead.handover_at) } : {}),
    },
  });
}
