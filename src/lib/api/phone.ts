// API phone normalization: accepts 08…, 8…, 62… and +62… and stores +62…
import { ApiError } from "./http";

export function toE164(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (!digits) {
    throw new ApiError(422, { message: "Nomor telepon wajib diisi." });
  }

  let local = digits;
  if (local.startsWith("62")) local = local.slice(2);
  else if (local.startsWith("0")) local = local.slice(1);

  if (!local.startsWith("8") || local.length < 8 || local.length > 13) {
    throw new ApiError(422, {
      message: "Format nomor tidak valid. Gunakan nomor Indonesia (08…, 62…, atau +62…).",
    });
  }
  return `+62${local}`;
}
