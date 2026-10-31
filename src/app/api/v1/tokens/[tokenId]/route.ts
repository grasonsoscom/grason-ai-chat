import { authenticateApiToken } from "@/lib/api/auth";
import { handleApi, noContent, notFound, pathId } from "@/lib/api/http";
import { FULL_ACCESS } from "@/lib/api/scopes";
import { db } from "@/lib/db";

export async function DELETE(req: Request, { params }: { params: Promise<{ tokenId: string }> }) {
  return handleApi(async () => {
    await authenticateApiToken(req, FULL_ACCESS);
    const id = pathId((await params).tokenId);
    const token = await db.apiToken.findUnique({ where: { id } });
    if (!token) throw notFound("Token not found.");
    if (!token.revokedAt) {
      await db.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
    }
    return noContent();
  });
}
