import { authenticateApiToken } from "@/lib/api/auth";
import { created, handleApi, ok, readJson, requiredString, validationError } from "@/lib/api/http";
import { buildLinks, buildMeta, parsePagination } from "@/lib/api/pagination";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  return handleApi(async () => {
    await authenticateApiToken(req, "contacts:read");
    const pagination = parsePagination(new URL(req.url).searchParams, 25);
    const [total, segments] = await Promise.all([
      db.audience.count(),
      db.audience.findMany({
        include: { _count: { select: { customers: true } } },
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.take,
      }),
    ]);

    return ok(
      segments.map((segment) => ({
        id: segment.id,
        name: segment.name,
        type: segment.type,
        contact_count: segment._count.customers,
        created_at: segment.createdAt.toISOString(),
      })),
      buildMeta(total, pagination),
      buildLinks(req, pagination, total),
    );
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    await authenticateApiToken(req, "contacts:write");
    const body = await readJson<Record<string, unknown>>(req);
    const name = requiredString(body.name, "name");

    const contactIds = Array.isArray(body.contact_ids)
      ? [...new Set(body.contact_ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
      : [];
    if (contactIds.length) {
      const found = await db.customer.count({ where: { id: { in: contactIds } } });
      if (found !== contactIds.length) {
        throw validationError({ contact_ids: ["Ada contact yang tidak ditemukan."] });
      }
    }

    const segment = await db.audience.create({
      data: {
        name,
        type: "Manual",
        ...(contactIds.length ? { customers: { connect: contactIds.map((id) => ({ id })) } } : {}),
      },
      include: { _count: { select: { customers: true } } },
    });

    return created({
      id: segment.id,
      name: segment.name,
      type: segment.type,
      contact_count: segment._count.customers,
      created_at: segment.createdAt.toISOString(),
    });
  });
}
