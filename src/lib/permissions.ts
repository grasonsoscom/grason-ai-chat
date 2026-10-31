// Module access per role. Role.permissions holds comma-separated module keys,
// or "all". The Admin role always has every module. Safe to import from client
// components (no database access here).

export const MODULES = [
  "pesan",
  "pelanggan",
  "kalender",
  "whatsapp",
  "produk",
  "funnels",
  "broadcast",
  "audience",
  "staff",
  "ai-agent",
  "integrasi",
] as const;

export type ModuleKey = (typeof MODULES)[number];

type RoleLike = { name: string; permissions: string };

export function isAdminRole(role: RoleLike) {
  return role.name === "Admin";
}

/** Module keys the role may open; every module for Admin or "all". */
export function allowedModules(role: RoleLike): ModuleKey[] {
  if (isAdminRole(role) || role.permissions.trim() === "all") return [...MODULES];
  const granted = new Set(role.permissions.split(",").map((p) => p.trim()));
  return MODULES.filter((m) => granted.has(m));
}

export function canAccess(role: RoleLike, module: ModuleKey) {
  return allowedModules(role).includes(module);
}
