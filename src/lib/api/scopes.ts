// Scopes for personal API tokens. "*" grants every scope.

export type ScopeKey =
  | "contacts:read"
  | "contacts:write"
  | "conversations:read"
  | "messages:write"
  | "campaigns:read"
  | "campaigns:write"
  | "webhooks:write"
  | "ai:read"
  | "ai:write"
  | "analytics:read"
  | "wallet:read";

export const FULL_ACCESS = "*";

export const SCOPES: { key: ScopeKey; label: string }[] = [
  { key: "contacts:read", label: "Baca kontak & segmen" },
  { key: "contacts:write", label: "Buat/ubah kontak & segmen" },
  { key: "conversations:read", label: "Baca percakapan & pesan" },
  { key: "messages:write", label: "Kirim pesan" },
  { key: "campaigns:read", label: "Baca campaign" },
  { key: "campaigns:write", label: "Buat & jalankan campaign" },
  { key: "webhooks:write", label: "Kelola webhook" },
  { key: "ai:read", label: "Baca chatbot" },
  { key: "ai:write", label: "Panggil chatbot" },
  { key: "analytics:read", label: "Baca analytics" },
  { key: "wallet:read", label: "Baca saldo & transaksi" },
];

export const SCOPE_KEYS = new Set<string>(SCOPES.map((s) => s.key));

export function parseScopes(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function hasScope(granted: string[], required?: string): boolean {
  if (!required) return true;
  return granted.includes(FULL_ACCESS) || granted.includes(required);
}

/** Validates UI/API scope arrays; unknown values are dropped. */
export function normalizeScopes(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<string>();
  for (const value of input) {
    if (typeof value !== "string") continue;
    const scope = value.trim();
    if (scope === FULL_ACCESS || SCOPE_KEYS.has(scope)) out.add(scope);
  }
  return [...out];
}

export function scopeLabel(scope: string): string {
  if (scope === FULL_ACCESS) return "Full access";
  return SCOPES.find((s) => s.key === scope)?.label ?? scope;
}
