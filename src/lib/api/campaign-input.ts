import { validationError } from "./http";

export function parseTemplateIds(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw validationError({ template_ids: ["template_ids wajib berisi minimal satu ID."] });
  }
  const ids = value.map(Number).filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length !== value.length) {
    throw validationError({ template_ids: ["template_ids harus bilangan bulat."] });
  }
  return ids;
}

export function parseCampaignType(value: unknown): "Single" | "Series" {
  return value === "Series" ? "Series" : "Single";
}
