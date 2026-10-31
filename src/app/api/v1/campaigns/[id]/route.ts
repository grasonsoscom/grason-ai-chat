import { authenticateApiToken } from "@/lib/api/auth";
import { rethrowCampaign } from "@/lib/api/campaign-errors";
import { parseCampaignType, parseTemplateIds } from "@/lib/api/campaign-input";
import {
  ApiError,
  handleApi,
  ok,
  pathId,
  readJson,
  requiredInteger,
  requiredString,
} from "@/lib/api/http";
import { campaignJson } from "@/lib/api/serializers";
import { getCampaign, updateCampaign, type CampaignInput } from "@/lib/campaigns";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    await authenticateApiToken(req, "campaigns:read");
    try {
      const campaign = await getCampaign(pathId((await params).id));
      return ok(campaignJson(campaign));
    } catch (e) {
      rethrowCampaign(e);
    }
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    await authenticateApiToken(req, "campaigns:write");
    const id = pathId((await params).id);
    const body = await readJson<Record<string, unknown>>(req);
    const patch: Partial<CampaignInput> = {};

    if (body.name !== undefined) patch.name = requiredString(body.name, "name");
    if (body.device_id !== undefined) patch.deviceId = requiredInteger(body.device_id, "device_id");
    if (body.audience_id !== undefined) patch.audienceId = requiredInteger(body.audience_id, "audience_id");
    if (body.template_ids !== undefined) patch.templateIds = parseTemplateIds(body.template_ids);
    if (body.type !== undefined) patch.type = parseCampaignType(body.type);
    if (Object.keys(patch).length === 0) throw new ApiError(422, { message: "Tidak ada field yang diubah." });

    try {
      const campaign = await updateCampaign(id, patch);
      return ok(campaignJson(campaign));
    } catch (e) {
      rethrowCampaign(e);
    }
  });
}
