import { authenticateApiToken } from "@/lib/api/auth";
import { rethrowCampaign } from "@/lib/api/campaign-errors";
import { created, handleApi, ok, readJson, requiredInteger, requiredString } from "@/lib/api/http";
import { parseCampaignType, parseTemplateIds } from "@/lib/api/campaign-input";
import { buildLinks, buildMeta, parsePagination } from "@/lib/api/pagination";
import { campaignJson } from "@/lib/api/serializers";
import { createCampaign, listCampaigns } from "@/lib/campaigns";

export async function GET(req: Request) {
  return handleApi(async () => {
    await authenticateApiToken(req, "campaigns:read");
    const pagination = parsePagination(new URL(req.url).searchParams, 25);
    const { total, items } = await listCampaigns(pagination);
    return ok(
      items.map(campaignJson),
      buildMeta(total, pagination),
      buildLinks(req, pagination, total),
    );
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const auth = await authenticateApiToken(req, "campaigns:write");
    const body = await readJson<Record<string, unknown>>(req);
    try {
      const campaign = await createCampaign({
        name: requiredString(body.name, "name"),
        deviceId: requiredInteger(body.device_id, "device_id"),
        audienceId: requiredInteger(body.audience_id, "audience_id"),
        templateIds: parseTemplateIds(body.template_ids),
        type: parseCampaignType(body.type),
        createdById: auth.user.id,
      });
      return created(campaignJson(campaign));
    } catch (e) {
      rethrowCampaign(e);
    }
  });
}
