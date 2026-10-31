import { authenticateApiToken } from "@/lib/api/auth";
import { handleApi, ok } from "@/lib/api/http";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  return handleApi(async () => {
    await authenticateApiToken(req, "wallet:read");
    const account = await db.account.findUnique({ where: { id: 1 }, select: { coins: true } });
    return ok({ coins: account?.coins ?? 0, currency: "coins" });
  });
}
