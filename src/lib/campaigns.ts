// Broadcast/campaign service shared by the UI and the public API.
// A campaign stores template IDs in Broadcast.message (comma-separated JSON list).
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { assertCoins, COIN_COSTS, spendCoins } from "./coins";
import { sendTemplateVia } from "./channel";
import { emitWebhook } from "./webhook";

export class CampaignError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "CampaignError";
  }
}

export type CampaignInput = {
  name: string;
  deviceId: number;
  audienceId: number;
  templateIds: number[];
  type?: "Single" | "Series";
  createdById?: number | null;
};

export const campaignInclude = {
  device: true,
  audience: { include: { _count: { select: { customers: true } } } },
  _count: { select: { recipients: true } },
} satisfies Prisma.BroadcastInclude;

export type CampaignRecord = Prisma.BroadcastGetPayload<{ include: typeof campaignInclude }>;

function parseTemplateIds(raw: string): number[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item) => typeof item === "number") : [];
  } catch {
    return [];
  }
}

async function loadTemplates(deviceId: number, templateIds: number[], type: "Single" | "Series") {
  if (templateIds.length === 0) throw new CampaignError(422, "Pilih minimal satu template pesan.");
  if (type === "Single" && templateIds.length > 1) {
    throw new CampaignError(422, "Campaign Single hanya memakai satu template.");
  }

  const templates = await db.messageTemplate.findMany({ where: { id: { in: templateIds } } });
  const ordered = templateIds
    .map((id) => templates.find((template) => template.id === id))
    .filter((template): template is (typeof templates)[number] => Boolean(template));

  if (ordered.length !== templateIds.length) throw new CampaignError(422, "Ada template yang tidak ditemukan.");
  if (ordered.some((template) => template.deviceId !== deviceId)) {
    throw new CampaignError(422, "Template harus berasal dari perangkat yang dipilih.");
  }
  return ordered;
}

export async function listCampaigns(pagination: { skip: number; take: number }) {
  const [total, items] = await Promise.all([
    db.broadcast.count(),
    db.broadcast.findMany({
      include: campaignInclude,
      orderBy: { updatedAt: "desc" },
      skip: pagination.skip,
      take: pagination.take,
    }),
  ]);
  return { total, items };
}

export async function getCampaign(id: number): Promise<CampaignRecord> {
  const campaign = await db.broadcast.findUnique({ where: { id }, include: campaignInclude });
  if (!campaign) throw new CampaignError(404, "Campaign tidak ditemukan.");
  return campaign;
}

export async function createCampaign(input: CampaignInput): Promise<CampaignRecord> {
  const name = input.name.trim();
  if (!name) throw new CampaignError(422, "Nama campaign wajib diisi.");

  const [device, audience] = await Promise.all([
    db.device.findUnique({ where: { id: input.deviceId } }),
    db.audience.findUnique({ where: { id: input.audienceId } }),
  ]);
  if (!device) throw new CampaignError(422, "Perangkat tidak ditemukan.");
  if (!audience) throw new CampaignError(422, "Audiens tidak ditemukan.");

  const type = input.type === "Series" ? "Series" : "Single";
  await loadTemplates(input.deviceId, input.templateIds, type);

  const created = await db.broadcast.create({
    data: {
      name,
      type,
      deviceId: input.deviceId,
      audienceId: input.audienceId,
      createdById: input.createdById ?? null,
      message: JSON.stringify(input.templateIds),
    },
  });
  return getCampaign(created.id);
}

export async function updateCampaign(id: number, input: Partial<CampaignInput>): Promise<CampaignRecord> {
  const current = await db.broadcast.findUnique({ where: { id } });
  if (!current) throw new CampaignError(404, "Campaign tidak ditemukan.");
  if (current.status !== "Draft") throw new CampaignError(409, "Hanya campaign Draft yang bisa diubah.");

  const deviceId = input.deviceId ?? current.deviceId;
  const audienceId = input.audienceId ?? current.audienceId;
  if (!deviceId) throw new CampaignError(422, "Perangkat wajib dipilih.");
  if (!audienceId) throw new CampaignError(422, "Audiens wajib dipilih.");

  const type: "Single" | "Series" =
    input.type === "Series" || input.type === "Single" ? input.type : current.type === "Series" ? "Series" : "Single";
  const templateIds = input.templateIds ?? parseTemplateIds(current.message);

  const [device, audience] = await Promise.all([
    db.device.findUnique({ where: { id: deviceId } }),
    db.audience.findUnique({ where: { id: audienceId } }),
  ]);
  if (!device) throw new CampaignError(422, "Perangkat tidak ditemukan.");
  if (!audience) throw new CampaignError(422, "Audiens tidak ditemukan.");
  await loadTemplates(deviceId, templateIds, type);

  await db.broadcast.update({
    where: { id },
    data: {
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      type,
      deviceId,
      audienceId,
      message: JSON.stringify(templateIds),
    },
  });
  return getCampaign(id);
}

export async function launchCampaign(
  id: number,
  opts: { allowResend?: boolean } = {},
): Promise<{ campaign: CampaignRecord; sent: number; total: number; status: string }> {
  const campaign = await db.broadcast.findUnique({
    where: { id },
    include: { device: true, audience: { include: { customers: true } } },
  });
  if (!campaign) throw new CampaignError(404, "Campaign tidak ditemukan.");
  if (campaign.status === "Mengirim") throw new CampaignError(409, "Campaign sedang mengirim.");
  if (campaign.status === "Terkirim") throw new CampaignError(409, "Campaign ini sudah terkirim.");
  if ((campaign.status === "Sebagian" || campaign.status === "Gagal") && !opts.allowResend) {
    throw new CampaignError(409, "Campaign ini sudah pernah dikirim. Buat campaign baru untuk mengirim ulang.");
  }
  if (!campaign.device) throw new CampaignError(422, "Perangkat campaign sudah dihapus.");
  if (!campaign.audience) throw new CampaignError(422, "Audiens campaign sudah dihapus.");

  const templateIds = parseTemplateIds(campaign.message);
  const templates = await loadTemplates(campaign.device.id, templateIds, campaign.type === "Series" ? "Series" : "Single");

  // Opt-out contacts are skipped, and are not charged.
  const customers = campaign.audience.customers.filter((customer) => customer.optInWhatsapp);
  if (customers.length === 0) throw new CampaignError(422, "Audiens kosong atau semua kontak memilih opt-out.");

  const total = customers.length * templates.length;
  const cost = total * COIN_COSTS.broadcastMessage;
  await assertCoins(cost);

  await db.broadcast.update({ where: { id }, data: { status: "Mengirim", sentCount: 0 } });
  await emitWebhook("campaign.started", {
    campaign_id: id,
    name: campaign.name,
    recipient_count: customers.length,
    message_count: total,
  });

  let sent = 0;
  let stopped = false;

  for (let index = 0; index < customers.length; index++) {
    // A pause request flips the status; check periodically without a query per customer.
    if (index % 10 === 0) {
      const current = await db.broadcast.findUnique({ where: { id }, select: { status: true } });
      if (current?.status === "Dijeda") {
        stopped = true;
        break;
      }
    }

    const customer = customers[index];
    const recipientKey = { broadcastId: id, customerId: customer.id };
    await db.broadcastRecipient.upsert({
      where: { broadcastId_customerId: recipientKey },
      update: { status: "pending", error: null, sentAt: null },
      create: recipientKey,
    });

    try {
      const conversation = await db.conversation.upsert({
        where: { customerId: customer.id },
        update: {},
        create: { customerId: customer.id, deviceId: campaign.device.id },
      });

      let customerSent = 0;
      let lastError: string | null = null;

      for (const template of templates) {
        const result = await sendTemplateVia(campaign.device, customer.phone, template);
        const text = `[Broadcast: ${template.name}] ${template.body}`;
        const message = await db.message.create({
          data: {
            conversationId: conversation.id,
            direction: "out",
            sender: "staff",
            text,
            status: result.status,
            externalId: result.externalId,
          },
        });
        if (result.status !== "failed") {
          sent++;
          customerSent++;
          // Do not block a large campaign on webhook latency; deliveries are
          // best-effort and campaign.completed is emitted at the end.
          void emitWebhook("message.sent", {
            conversation_id: conversation.id,
            message_id: message.id,
            sender: "staff",
            body: text,
            status: result.status,
            campaign_id: id,
          });
        } else {
          lastError = result.error ?? "Gagal terkirim";
        }
      }

      await db.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });
      await db.broadcastRecipient.update({
        where: { broadcastId_customerId: recipientKey },
        data: {
          status: customerSent === templates.length ? "sent" : "failed",
          error: customerSent === templates.length ? null : lastError,
          sentAt: new Date(),
        },
      });
    } catch (e) {
      await db.broadcastRecipient
        .update({
          where: { broadcastId_customerId: recipientKey },
          data: { status: "failed", error: (e as Error).message.slice(0, 500), sentAt: new Date() },
        })
        .catch(() => {});
    }
  }

  await spendCoins(sent * COIN_COSTS.broadcastMessage, `Campaign "${campaign.name}" (${sent} pesan)`);

  const status = stopped ? "Dijeda" : sent === total ? "Terkirim" : sent ? "Sebagian" : "Gagal";
  await db.broadcast.update({ where: { id }, data: { status, sentCount: sent } });
  await emitWebhook("campaign.completed", {
    campaign_id: id,
    name: campaign.name,
    status,
    sent,
    total,
  });

  return { campaign: await getCampaign(id), sent, total, status };
}

export async function pauseCampaign(id: number): Promise<CampaignRecord> {
  const campaign = await db.broadcast.findUnique({ where: { id } });
  if (!campaign) throw new CampaignError(404, "Campaign tidak ditemukan.");
  if (campaign.status !== "Mengirim") throw new CampaignError(409, "Campaign tidak sedang mengirim.");
  await db.broadcast.update({ where: { id }, data: { status: "Dijeda" } });
  return getCampaign(id);
}

export async function listRecipients(
  campaignId: number,
  pagination: { skip: number; take: number },
) {
  const [total, items] = await Promise.all([
    db.broadcastRecipient.count({ where: { broadcastId: campaignId } }),
    db.broadcastRecipient.findMany({
      where: { broadcastId: campaignId },
      include: { customer: true },
      orderBy: { createdAt: "asc" },
      skip: pagination.skip,
      take: pagination.take,
    }),
  ]);
  return { total, items };
}
