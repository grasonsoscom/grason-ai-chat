import { authenticateApiToken } from "@/lib/api/auth";
import { handleApi, ok } from "@/lib/api/http";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  return handleApi(async () => {
    const auth = await authenticateApiToken(req);
    const account = await db.account.findUnique({
      where: { id: 1 },
      select: { name: true, coins: true },
    });
    return ok({
      user: auth.user,
      token: { id: auth.tokenId, name: auth.tokenName, scopes: auth.scopes },
      workspace: account ?? null,
    });
  });
}
