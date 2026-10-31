// Rules that keep an AI-created order out of auto-verification so staff
// confirm it by hand first (agreed business rules, not an OMS contract):
// - address without RT/RW, kecamatan or kode pos
// - customer had an order returned (RTS) before
// - COD of the checkout above Rp 500.000

export const RTS_COD_LIMIT = 500_000;

type Alamat = { alamat: string; kecamatan?: string; kode_pos?: string };

/** "RT 01 RW 02", "RT.3/RW.4", "rt01 rw05" or "001/002". */
export function hasRtRw(alamat: string) {
  const text = alamat.toLowerCase();
  const both = /\brt\.?\s*0*\d{1,3}\b[\s\S]*\brw\.?\s*0*\d{1,3}\b/.test(text);
  const slash = /\b\d{1,3}\s*\/\s*\d{1,3}\b/.test(text);
  return both || slash;
}

export function rtsRiskReasons(input: { alamat: Alamat; totalCod: number; previousRts: number }): string[] {
  const reasons: string[] = [];
  const missing = [
    hasRtRw(input.alamat.alamat) ? null : "RT/RW",
    input.alamat.kecamatan?.trim() ? null : "kecamatan",
    /^\d{5}$/.test(input.alamat.kode_pos?.trim() ?? "") ? null : "kode pos",
  ].filter(Boolean);
  if (missing.length) reasons.push(`alamat belum lengkap (${missing.join(", ")})`);
  if (input.previousRts > 0) reasons.push(`pelanggan pernah RTS (${input.previousRts}x)`);
  if (input.totalCod > RTS_COD_LIMIT) reasons.push("nilai COD di atas Rp 500.000");
  return reasons;
}
