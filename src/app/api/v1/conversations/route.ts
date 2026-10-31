import type { Prisma } from "@prisma/client";
import { authenticateApiToken } from "@/lib/api/auth";
import { handleApi, ok } from "@/lib/api/http";
import { buildLinks, buildMeta, parsePagination } from "@/lib/api/pagination";
import { conversationJson } from "@/lib/api/serializers";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  return handleApi(async () => {
    await authenticateApiToken(req, "conversations:read");
    const url = new URL(req.url);
    const pagination = parsePagination(url.searchParams, 25);
    const q = (url.searchParams.get("q") ?? "").trim();
    const mode = url.searchParams.get("mode");
    const where: Prisma.ConversationWhereInput = {
      ...(mode && ["ai", "staf", "eskalasi"].includes(mode) ? { mode } : {}),
      ...(q
        ? {
            customer: {
              OR: [{ name: { contains: q } }, { phone: { contains: q } }],
            },
          }
        : {}),
    };

    const [total, conversations] = await Promise.all([
      db.conversation.count({ where }),
      db.conversation.findMany({
        where,
        include: {
          customer: true,
          messages: {
            where: { sender: { not: "system" } },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
        orderBy: { lastMessageAt: "desc" },
        skip: pagination.skip,
        take: pagination.take,
      }),
    ]);

    return ok(
      conversations.map(conversationJson),
      buildMeta(total, pagination),
      buildLinks(req, pagination, total),
    );
  });
}
