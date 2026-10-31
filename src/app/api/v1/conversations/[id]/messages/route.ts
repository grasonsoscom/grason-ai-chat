import { authenticateApiToken } from "@/lib/api/auth";
import { handleApi, notFound, ok, pathId } from "@/lib/api/http";
import { buildLinks, buildMeta, parsePagination } from "@/lib/api/pagination";
import { messageJson } from "@/lib/api/serializers";
import { db } from "@/lib/db";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    await authenticateApiToken(req, "conversations:read");
    const id = pathId((await params).id);
    const conversation = await db.conversation.findUnique({ where: { id }, select: { id: true } });
    if (!conversation) throw notFound("Conversation not found.");

    const pagination = parsePagination(new URL(req.url).searchParams, 50);
    const where = { conversationId: id };
    const [total, messages] = await Promise.all([
      db.message.count({ where }),
      db.message.findMany({
        where,
        orderBy: { createdAt: "asc" },
        skip: pagination.skip,
        take: pagination.take,
      }),
    ]);

    return ok(
      messages.map(messageJson),
      buildMeta(total, pagination),
      buildLinks(req, pagination, total),
    );
  });
}
