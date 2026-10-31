import { authenticateApiToken } from "@/lib/api/auth";
import { handleApi, notFound, ok, pathId } from "@/lib/api/http";
import { buildLinks, buildMeta, parsePagination } from "@/lib/api/pagination";
import { contactJson } from "@/lib/api/serializers";
import { db } from "@/lib/db";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    await authenticateApiToken(req, "contacts:read");
    const id = pathId((await params).id);
    const segment = await db.audience.findUnique({ where: { id }, select: { id: true } });
    if (!segment) throw notFound("Segment not found.");

    const pagination = parsePagination(new URL(req.url).searchParams, 25);
    const where = { audiences: { some: { id } } };
    const [total, contacts] = await Promise.all([
      db.customer.count({ where }),
      db.customer.findMany({
        where,
        include: { labels: true, stage: true },
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.take,
      }),
    ]);

    return ok(
      contacts.map(contactJson),
      buildMeta(total, pagination),
      buildLinks(req, pagination, total),
    );
  });
}
