import { authenticateApiToken } from "@/lib/api/auth";
import { handleApi, ok } from "@/lib/api/http";
import { buildLinks, buildMeta, parsePagination } from "@/lib/api/pagination";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  return handleApi(async () => {
    await authenticateApiToken(req, "wallet:read");
    const pagination = parsePagination(new URL(req.url).searchParams, 25);
    const [total, transactions] = await Promise.all([
      db.coinTransaction.count(),
      db.coinTransaction.findMany({
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.take,
      }),
    ]);

    return ok(
      transactions.map((transaction) => ({
        id: transaction.id,
        amount: transaction.amount,
        reason: transaction.reason,
        created_at: transaction.createdAt.toISOString(),
      })),
      buildMeta(total, pagination),
      buildLinks(req, pagination, total),
    );
  });
}
