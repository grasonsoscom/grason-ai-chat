// RajaOngkir (Komerce) domestic shipping cost API.
// Docs: https://rajaongkir.com/docs/shipping-cost/getting_started/endpoint
// Config comes from the web UI (Account) with an env fallback; the API key is encrypted at rest.
import { db } from "./db";
import { decryptSecret, encryptSecret } from "./secret-box";

export const RAJAONGKIR_BASE = "https://rajaongkir.komerce.id/api/v1";

export type DomesticDestination = {
  id: number;
  label: string;
  province_name: string;
  city_name: string;
  district_name: string;
  subdistrict_name: string;
  zip_code: string;
};

export type DomesticCost = {
  name: string;
  code: string;
  service: string;
  description: string;
  cost: number;
  etd: string;
};

export type RajaOngkirConfig = {
  apiKey: string;
  originId: number;
  originLabel: string;
  courier: string;
  weight: number;
  source: "db" | "env";
};

export class RajaOngkirError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "RajaOngkirError";
  }
}

/** Couriers offered in the settings form; the cheapest of the chosen ones wins. */
export const COURIER_OPTIONS = ["jnt", "jne", "sicepat", "anteraja", "pos", "tiki", "ide", "sap", "ninja", "lion"] as const;
export const DEFAULT_COURIERS = "jnt:jne:sicepat";

/**
 * "jnt, JNE:sicepat" -> "jnt:jne:sicepat". RajaOngkir takes several couriers in one
 * call separated by ":" and only returns the ones that serve the route.
 */
export function normalizeCouriers(input: string) {
  const codes = [...new Set(input.toLowerCase().split(/[\s,:;]+/).filter(Boolean))];
  if (!codes.length || codes.length > 10 || codes.some((c) => !/^[a-z0-9_-]{2,20}$/.test(c))) {
    throw new Error("Kode kurir tidak valid. Contoh: jnt, jne, sicepat.");
  }
  return codes.join(":");
}

function envNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function envConfig(): RajaOngkirConfig | null {
  const apiKey = process.env.RAJAONGKIR_API_KEY?.trim() ?? "";
  const originId = Number(process.env.RAJAONGKIR_ORIGIN_ID);
  if (!apiKey || !Number.isInteger(originId) || originId <= 0) return null;
  return {
    apiKey,
    originId,
    originLabel: process.env.RAJAONGKIR_ORIGIN_LABEL?.trim() || `ID ${originId}`,
    courier: process.env.RAJAONGKIR_COURIER?.trim() || DEFAULT_COURIERS,
    weight: envNumber("RAJAONGKIR_WEIGHT", 1000),
    source: "env",
  };
}

/** DB settings win when both a decryptable key and an origin are stored. */
export async function getRajaOngkirConfig(): Promise<RajaOngkirConfig | null> {
  const account = await db.account.findUnique({
    where: { id: 1 },
    select: {
      rajaOngkirApiKeyEnc: true,
      rajaOngkirOriginId: true,
      rajaOngkirOriginLabel: true,
      rajaOngkirCourier: true,
      rajaOngkirWeight: true,
    },
  });
  const apiKey = account?.rajaOngkirApiKeyEnc ? decryptSecret(account.rajaOngkirApiKeyEnc)?.trim() : "";
  if (apiKey && account?.rajaOngkirOriginId && account.rajaOngkirOriginId > 0) {
    return {
      apiKey,
      originId: account.rajaOngkirOriginId,
      originLabel: account.rajaOngkirOriginLabel || `ID ${account.rajaOngkirOriginId}`,
      courier: account.rajaOngkirCourier || DEFAULT_COURIERS,
      weight: account.rajaOngkirWeight || 1000,
      source: "db",
    };
  }
  return envConfig();
}

/** Stored key even when the origin is not set yet (used for origin search during setup). */
export async function getRajaOngkirApiKey() {
  const account = await db.account.findUnique({
    where: { id: 1 },
    select: { rajaOngkirApiKeyEnc: true },
  });
  const key = account?.rajaOngkirApiKeyEnc ? decryptSecret(account.rajaOngkirApiKeyEnc)?.trim() : "";
  return key || process.env.RAJAONGKIR_API_KEY?.trim() || "";
}

export type RajaOngkirStatus = {
  configured: boolean;
  hasKey: boolean;
  originId: number | null;
  originLabel: string;
  courier: string;
  weight: number;
  source: "db" | "env" | "none";
};

/** Safe for pages: never returns the API key. */
export async function getRajaOngkirStatus(): Promise<RajaOngkirStatus> {
  const [config, account] = await Promise.all([
    getRajaOngkirConfig(),
    db.account.findUnique({
      where: { id: 1 },
      select: {
        rajaOngkirApiKeyEnc: true,
        rajaOngkirOriginId: true,
        rajaOngkirOriginLabel: true,
        rajaOngkirCourier: true,
        rajaOngkirWeight: true,
      },
    }),
  ]);
  const dbKey = account?.rajaOngkirApiKeyEnc ? decryptSecret(account.rajaOngkirApiKeyEnc) : null;
  return {
    configured: Boolean(config),
    hasKey: Boolean(dbKey || process.env.RAJAONGKIR_API_KEY?.trim()),
    originId: config?.originId ?? account?.rajaOngkirOriginId ?? null,
    originLabel: config?.originLabel || account?.rajaOngkirOriginLabel || "",
    courier: config?.courier || account?.rajaOngkirCourier || DEFAULT_COURIERS,
    weight: config?.weight || account?.rajaOngkirWeight || 1000,
    source: config?.source ?? (dbKey || account?.rajaOngkirOriginId ? "db" : "none"),
  };
}

export async function saveRajaOngkirSettings(input: {
  apiKey?: string;
  originId: number;
  originLabel: string;
  courier: string;
  weight: number;
}) {
  const current = await db.account.findUnique({
    where: { id: 1 },
    select: { rajaOngkirApiKeyEnc: true },
  });
  const newKey = input.apiKey?.trim();
  const storedKey =
    (current?.rajaOngkirApiKeyEnc ? decryptSecret(current.rajaOngkirApiKeyEnc) : null) ||
    process.env.RAJAONGKIR_API_KEY?.trim() ||
    null;
  if (!newKey && !storedKey) throw new Error("API key RajaOngkir wajib diisi.");

  if (!Number.isInteger(input.originId) || input.originId <= 0) {
    throw new Error("Pilih kota/kecamatan asal pengiriman dari hasil pencarian.");
  }
  const courier = normalizeCouriers(input.courier);
  if (!Number.isInteger(input.weight) || input.weight < 1 || input.weight > 100000) {
    throw new Error("Berat default harus 1–100.000 gram.");
  }

  await db.account.update({
    where: { id: 1 },
    data: {
      rajaOngkirApiKeyEnc: newKey
        ? encryptSecret(newKey)
        : (current?.rajaOngkirApiKeyEnc || encryptSecret(storedKey!)),
      rajaOngkirOriginId: input.originId,
      rajaOngkirOriginLabel: input.originLabel.trim() || `ID ${input.originId}`,
      rajaOngkirCourier: courier,
      rajaOngkirWeight: input.weight,
    },
  });
}

type Meta = { message?: string; code?: number | string; status?: string };

function friendlyError(status: number, code: string, message: string) {
  if (status === 401 || /api\s*key/i.test(message)) {
    return "API key RajaOngkir tidak valid atau tidak punya akses Shipping Cost.";
  }
  if (status === 422) return `RajaOngkir menolak parameter: ${message}`;
  if (status === 404) return "Daerah tujuan tidak ditemukan di RajaOngkir.";
  if (status >= 500) return "Server RajaOngkir sedang bermasalah. Coba lagi nanti.";
  return message || `RajaOngkir membalas ${status} (${code}).`;
}

async function request<T>(path: string, apiKey: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${RAJAONGKIR_BASE}${path}`, {
      ...init,
      headers: { key: apiKey, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new RajaOngkirError(0, "jaringan", "Tidak dapat terhubung ke RajaOngkir. Cek koneksi lalu coba lagi.");
  }
  const json = (await res.json().catch(() => null)) as { meta?: Meta; data?: T } | null;
  if (!res.ok || !json || json.meta?.status === "error") {
    const code = String(json?.meta?.code ?? res.status);
    const message = json?.meta?.message ?? `RajaOngkir membalas ${res.status}.`;
    throw new RajaOngkirError(res.status, code, friendlyError(res.status, code, message));
  }
  return json.data as T;
}

const destinationCache = new Map<string, { at: number; data: DomesticDestination[] }>();
const DESTINATION_TTL_MS = 10 * 60_000;

export function clearDestinationCache() {
  destinationCache.clear();
}

/** Low-level search. Cached for 10 minutes because destination names change rarely. */
export async function fetchDestinations(
  apiKey: string,
  query: string,
  opts: { limit?: number; offset?: number; cache?: boolean } = {},
): Promise<DomesticDestination[]> {
  const q = query.trim();
  if (q.length < 2) throw new Error("Ketik minimal 2 karakter nama daerah atau kode pos.");
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
  const offset = Math.max(opts.offset ?? 0, 0);
  const cacheKey = `${q.toLowerCase()}|${limit}|${offset}`;
  const cached = destinationCache.get(cacheKey);
  if (opts.cache !== false && cached && Date.now() - cached.at < DESTINATION_TTL_MS) return cached.data;

  const params = new URLSearchParams({ search: q, limit: String(limit), offset: String(offset) });
  const data = await request<DomesticDestination[] | null>(
    `/destination/domestic-destination?${params}`,
    apiKey,
    { method: "GET" },
  );
  const rows = (data ?? []).map((row) => ({
    id: Number(row.id),
    label: row.label ?? "",
    province_name: row.province_name ?? "",
    city_name: row.city_name ?? "",
    district_name: row.district_name ?? "",
    subdistrict_name: row.subdistrict_name ?? "",
    zip_code: row.zip_code ?? "",
  }));
  destinationCache.set(cacheKey, { at: Date.now(), data: rows });
  if (destinationCache.size > 100) {
    const oldest = [...destinationCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) destinationCache.delete(oldest[0]);
  }
  return rows;
}

/**
 * Low-level domestic cost. Weight is grams; courier is one RajaOngkir code or several
 * joined by ":" (jnt:jne:sicepat). Rows come back cheapest first across all couriers.
 */
export async function fetchDomesticCost(
  apiKey: string,
  input: { origin: number; destination: number; weight: number; courier: string },
): Promise<DomesticCost[]> {
  if (!Number.isInteger(input.origin) || input.origin <= 0) throw new Error("ID kota asal tidak valid.");
  if (!Number.isInteger(input.destination) || input.destination <= 0) throw new Error("Pilih daerah tujuan dulu.");
  if (!Number.isInteger(input.weight) || input.weight < 1 || input.weight > 100000) {
    throw new Error("Berat paket harus 1–100.000 gram.");
  }
  const courier = normalizeCouriers(input.courier);

  const body = new URLSearchParams({
    origin: String(input.origin),
    destination: String(input.destination),
    weight: String(input.weight),
    courier,
    price: "lowest",
  });
  let data: DomesticCost[] | null;
  try {
    data = await request<DomesticCost[] | null>("/calculate/domestic-cost", apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (e) {
    // The destination was already found; a 404 here means no chosen courier serves the route.
    if (e instanceof RajaOngkirError && e.status === 404) return [];
    throw e;
  }
  return (data ?? [])
    .map((row) => ({
      name: row.name ?? "",
      code: row.code ?? courier,
      service: row.service ?? "",
      description: row.description ?? "",
      cost: Number(row.cost),
      etd: row.etd == null ? "" : String(row.etd),
    }))
    .filter((row) => Number.isFinite(row.cost) && row.cost >= 0)
    .sort((a, b) => a.cost - b.cost);
}

/** High-level helpers used by routes; they load the saved configuration. */
export async function searchDomesticDestinations(query: string, opts: { limit?: number; offset?: number } = {}) {
  const config = await getRajaOngkirConfig();
  if (!config) throw new RajaOngkirError(503, "belum_dikonfigurasi", "RajaOngkir belum dikonfigurasi. Isi API key dan kota asal di Integrasi.");
  return fetchDestinations(config.apiKey, query, opts);
}

export async function calculateDomesticCost(input: { destinationId: number; weight?: number; courier?: string }) {
  const config = await getRajaOngkirConfig();
  if (!config) throw new RajaOngkirError(503, "belum_dikonfigurasi", "RajaOngkir belum dikonfigurasi. Isi API key dan kota asal di Integrasi.");
  return fetchDomesticCost(config.apiKey, {
    origin: config.originId,
    destination: input.destinationId,
    weight: input.weight ?? config.weight,
    courier: input.courier ?? config.courier,
  });
}
