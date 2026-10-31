// One-time migration from the old single Account.webhookUrl to a proper
// WebhookEndpoint. The legacy columns are cleared but kept in the schema so
// `prisma db push` stays non-destructive on existing deployments.
import { db } from "../db";
import { generateWebhookSecret } from "./signature";

export async function migrateLegacyWebhook() {
  const account = await db.account.findUnique({ where: { id: 1 } });
  if (!account?.webhookUrl) return;

  const existing = await db.webhookEndpoint.count();
  if (existing > 0) return;

  await db.webhookEndpoint.create({
    data: {
      name: "Webhook lama",
      url: account.webhookUrl,
      secret: generateWebhookSecret(),
      events: "", // all events
      description: "Dimigrasikan otomatis dari pengaturan Integrasi.",
      enabled: account.webhookEnabled,
    },
  });

  await db.account.update({
    where: { id: 1 },
    data: { webhookUrl: null, webhookEnabled: false },
  });
}
