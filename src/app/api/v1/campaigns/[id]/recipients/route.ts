import { authenticateApiToken } from "@/lib/api/auth";
import { handleApi, notFound, ok, pathId } from "@/lib/api/http";
import { buildLinks, buildMeta, parsePagination } from "@/lib/api/pagination";
import { listRecipients } from "@/lib/campaigns";
import { db } from "@/lib/db";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    await authenticateApiToken(req, "campaigns:read");
    const id = pathId((await params).id);
    const campaign = await db.broadcast.findUnique({ where: { id }, select: { id: true } });
    if (!campaign) throw notFound("Campaign not found.");

    const pagination = parsePagination(new URL(req.url).searchParams, 50);
    const { total, items } = await listRecipients(id, pagination);

    return ok(
      items.map((recipient) => ({
        id: recipient.id,
        status: recipient.status,
        error: recipient.error,
        sent_at: recipient.sentAt?.toISOString() ?? null,
        customer: {
          id: recipient.customer.id,
          name: recipient.customer.name,
          phone: recipient.customer.phone,
        },
      })),
      buildMeta(total, pagination),
      buildLinks(req, pagination, total),
    );
  });
}
