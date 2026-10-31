import { authenticateApiToken } from "@/lib/api/auth";
import { rethrowCampaign } from "@/lib/api/campaign-errors";
import { handleApi, ok, pathId } from "@/lib/api/http";
import { campaignJson } from "@/lib/api/serializers";
import { pauseCampaign } from "@/lib/campaigns";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    await authenticateApiToken(req, "campaigns:write");
    const id = pathId((await params).id);
    try {
      return ok(campaignJson(await pauseCampaign(id)));
    } catch (e) {
      rethrowCampaign(e);
    }
  });
}
