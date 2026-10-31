import { authenticateApiToken } from "@/lib/api/auth";
import { handleApi, ok } from "@/lib/api/http";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  return handleApi(async () => {
    await authenticateApiToken(req, "ai:read");
    const agents = await db.aiAgent.findMany({
      orderBy: { id: "asc" },
      include: { _count: { select: { products: true, devices: true } } },
    });
    return ok(
      agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        description: agent.description,
        base_learning: agent.baseLearning,
        active: agent.active,
        product_count: agent._count.products,
        device_count: agent._count.devices,
        updated_at: agent.updatedAt.toISOString(),
      })),
    );
  });
}
