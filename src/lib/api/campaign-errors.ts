import { CampaignError } from "../campaigns";
import { ApiError } from "./http";

/** Converts service-level campaign errors into API responses. */
export function rethrowCampaign(e: unknown): never {
  if (e instanceof CampaignError) throw new ApiError(e.status, { message: e.message });
  throw e;
}
