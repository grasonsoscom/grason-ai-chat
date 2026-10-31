// HTTP client for OMS GRASON. Every OMS call in the app must go through this
// module; nothing else may call the OMS API or touch its database.
import type {
  Checkout,
  Galat,
  Harga,
  KoreksiAlamat,
  Lead,
  LeadBaru,
  ListResponse,
  Order,
  OrderBaru,
  Stok,
  UbahLead,
  Verifikasi,
} from "./types";

export class OmsNotConfiguredError extends Error {
  constructor() {
    super("OMS belum dikonfigurasi. Isi OMS_BASE_URL dan OMS_API_KEY di environment.");
    this.name = "OmsNotConfiguredError";
  }
}

export class OmsApiError extends Error {
  constructor(
    public status: number,
    public kode: string,
    message: string,
    public detail?: unknown,
    public path?: string,
  ) {
    super(message);
    this.name = "OmsApiError";
  }
}

export class OmsNetworkError extends Error {
  constructor(message: string, public path?: string) {
    super(message);
    this.name = "OmsNetworkError";
  }
}

type Method = "GET" | "POST" | "PATCH";

export type OmsRequestOptions = {
  method?: Method;
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
  /** Tests override this to avoid waiting between retries. */
  retryDelaysMs?: number[];
};

export function omsConfigured() {
  return Boolean(process.env.OMS_BASE_URL?.trim() && process.env.OMS_API_KEY?.trim());
}

export function omsHost() {
  const base = process.env.OMS_BASE_URL?.trim();
  if (!base) return null;
  try {
    return new URL(base).host;
  } catch {
    return "URL tidak valid";
  }
}

function baseUrl() {
  return (process.env.OMS_BASE_URL ?? "").trim().replace(/\/+$/, "");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function externalIdOf(body: unknown): string | undefined {
  if (body && typeof body === "object" && "external_id" in body) {
    const value = (body as { external_id?: unknown }).external_id;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

function log(entry: Record<string, unknown>) {
  // Never log API keys, phone numbers, or customer names.
  console.info(`[oms] ${JSON.stringify(entry)}`);
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Low-level request helper. Retries network errors and 429/5xx with
 * exponential backoff. Writes are idempotent because callers persist and
 * reuse external_id (lead/order) or call an idempotent verify endpoint.
 */
export async function omsRequest<T>(path: string, opts: OmsRequestOptions = {}): Promise<T> {
  if (!omsConfigured()) throw new OmsNotConfiguredError();
  const method = opts.method ?? "GET";
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const retries = opts.retries ?? (method === "GET" ? 2 : 1);
  const delays = opts.retryDelaysMs ?? [2000, 4000, 8000];
  const externalId = externalIdOf(opts.body);

  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(`${baseUrl()}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${process.env.OMS_API_KEY}`,
          ...(opts.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log({ path, method, error: message, duration: Date.now() - started, externalId });
      if (attempt < retries) {
        await sleep(delays[Math.min(attempt, delays.length - 1)]);
        continue;
      }
      throw new OmsNetworkError("Tidak dapat terhubung ke OMS. Coba lagi nanti.", path);
    }

    const text = await response.text().catch(() => "");
    const json = parseJson(text);
    const duration = Date.now() - started;

    if (!response.ok) {
      const body = json as Galat | undefined;
      const kode = body?.error?.kode ?? `http_${response.status}`;
      const pesan = body?.error?.pesan ?? `OMS membalas ${response.status}.`;
      log({ path, method, status: response.status, kode, duration, externalId });
      const error = new OmsApiError(response.status, kode, pesan, body?.error?.detail, path);
      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        await sleep(delays[Math.min(attempt, delays.length - 1)]);
        continue;
      }
      throw error;
    }

    log({ path, method, status: response.status, duration, externalId });
    return (json ?? {}) as T;
  }
}

export function createLead(input: LeadBaru) {
  return omsRequest<Lead>("/leads", { method: "POST", body: input, retries: 2 });
}

export function getLead(id: string) {
  return omsRequest<Lead>(`/leads/${encodeURIComponent(id)}`);
}

export function updateLead(id: string, patch: UbahLead) {
  return omsRequest<Lead>(`/leads/${encodeURIComponent(id)}`, { method: "PATCH", body: patch, retries: 1 });
}

export function createOrder(input: OrderBaru) {
  return omsRequest<Checkout>("/orders", { method: "POST", body: input, retries: 2 });
}

export function verifyOrder(id: string, input: Verifikasi) {
  return omsRequest<Order>(`/orders/${encodeURIComponent(id)}/verifikasi`, { method: "POST", body: input, retries: 2 });
}

/** cs-ai.v3 only (OMS_BASE_URL …/api/v3). Idempotent for an order that is already batal. */
export function cancelOrder(id: string, alasan: string) {
  return omsRequest<Order>(`/orders/${encodeURIComponent(id)}/batal`, { method: "POST", body: { alasan }, retries: 2 });
}

/** cs-ai.v3 only. Allowed while the order is baru/terverifikasi; ongkir is not recalculated. */
export function correctOrderAddress(id: string, input: KoreksiAlamat) {
  return omsRequest<Order>(`/orders/${encodeURIComponent(id)}/alamat`, { method: "PATCH", body: input, retries: 2 });
}

export function getOrder(id: string) {
  return omsRequest<Order>(`/orders/${encodeURIComponent(id)}`);
}

/**
 * Catalog reads fail fast (no retries) so chat replies are not held up when
 * OMS is down; the next reply will try again and refresh the 5-minute cache.
 */
export function getStock(skus?: string[], timeoutMs = 5000) {
  const query = skus?.length ? `?sku=${encodeURIComponent(skus.join(","))}` : "";
  return omsRequest<ListResponse<Stok>>(`/stock${query}`, { timeoutMs, retries: 0 });
}

export function getPrices(timeoutMs = 5000) {
  return omsRequest<ListResponse<Harga>>("/prices", { timeoutMs, retries: 0 });
}
