import { authenticateApiToken } from "@/lib/api/auth";
import { rethrowCampaign } from "@/lib/api/campaign-errors";
import { handleApi, ok, pathId } from "@/lib/api/http";
import { campaignJson } from "@/lib/api/serializers";
import { launchCampaign } from "@/lib/campaigns";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    await authenticateApiToken(req, "campaigns:write");
    const id = pathId((await params).id);
    try {
      const result = await launchCampaign(id, { allowResend: false });
      return ok(campaignJson(result.campaign), {
        sent: result.sent,
        total: result.total,
        status: result.status,
      });
    } catch (e) {
      rethrowCampaign(e);
    }
  });
}
