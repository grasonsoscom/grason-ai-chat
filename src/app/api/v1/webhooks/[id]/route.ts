import { authenticateApiToken } from "@/lib/api/auth";
import { handleApi, noContent, notFound, pathId } from "@/lib/api/http";
import { db } from "@/lib/db";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    await authenticateApiToken(req, "webhooks:write");
    const id = pathId((await params).id);
    const endpoint = await db.webhookEndpoint.findUnique({ where: { id }, select: { id: true } });
    if (!endpoint) throw notFound("Webhook not found.");
    await db.webhookEndpoint.delete({ where: { id } });
    return noContent();
  });
}
