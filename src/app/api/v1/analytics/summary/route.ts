import { authenticateApiToken } from "@/lib/api/auth";
import { handleApi, ok } from "@/lib/api/http";
import { db } from "@/lib/db";

function sumCounts(values: Record<string, number>) {
  return Object.values(values).reduce((total, value) => total + value, 0);
}

export async function GET(req: Request) {
  return handleApi(async () => {
    await authenticateApiToken(req, "analytics:read");
    const [contacts, conversations, messages, campaigns, account] = await Promise.all([
      db.customer.count(),
      db.conversation.groupBy({ by: ["mode"], _count: true }),
      db.message.groupBy({ by: ["direction"], _count: true }),
      db.broadcast.groupBy({ by: ["status"], _count: true }),
      db.account.findUnique({ where: { id: 1 }, select: { coins: true } }),
    ]);

    const byMode = Object.fromEntries(conversations.map((row) => [row.mode, row._count]));
    const byDirection = Object.fromEntries(messages.map((row) => [row.direction, row._count]));
    const byStatus = Object.fromEntries(campaigns.map((row) => [row.status, row._count]));

    return ok({
      contacts,
      conversations: { total: sumCounts(byMode), by_mode: byMode },
      messages: { total: sumCounts(byDirection), by_direction: byDirection },
      campaigns: { total: sumCounts(byStatus), by_status: byStatus },
      coins: account?.coins ?? 0,
    });
  });
}
