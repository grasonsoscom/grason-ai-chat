// Prices and stock are always read from OMS and cached for at most 5 minutes
// (section 1: never store a permanent SKU/price list in code or prompts).
import { getPrices, getStock, omsConfigured } from "./client";
import type { Harga, Stok } from "./types";

export type OmsCatalog = {
  prices: Harga[];
  stock: Stok[];
  fetchedAt: number;
};

const TTL_MS = 5 * 60 * 1000;
const g = globalThis as { omsCatalog?: OmsCatalog };

export async function getOmsCatalog(opts: { force?: boolean } = {}): Promise<OmsCatalog | null> {
  if (!omsConfigured()) return null;

  const cached = g.omsCatalog;
  if (!opts.force && cached && Date.now() - cached.fetchedAt < TTL_MS) return cached;

  try {
    const [prices, stock] = await Promise.all([getPrices(), getStock()]);
    const catalog: OmsCatalog = {
      prices: prices.data ?? [],
      stock: stock.data ?? [],
      fetchedAt: Date.now(),
    };
    g.omsCatalog = catalog;
    return catalog;
  } catch (e) {
    console.error("[oms] catalog fetch failed:", (e as Error).message);
    // A failed refresh must not serve data older than the 5-minute window.
    return null;
  }
}

export function catalogPrompt(catalog: OmsCatalog): string {
  const stockBySku = new Map(catalog.stock.map((s) => [s.sku, s]));
  const lines = catalog.prices.map((p) => {
    const stock = stockBySku.get(p.sku);
    const komponen = p.komponen?.length
      ? ` Isi paket: ${p.komponen.map((k) => `${k.sku} x${k.qty}`).join(", ")}.`
      : "";
    return `- ${p.sku} | ${p.nama} | ${p.tipe} | ${p.entitas} | Rp${p.harga_jual.toLocaleString("id-ID")} | stok ${stock ? stock.tersedia : "tidak diketahui"}.${komponen}`;
  });

  return [
    `Katalog OMS GRASON (harga & stok per ${new Date(catalog.fetchedAt).toISOString()}; ini satu-satunya sumber harga dan stok yang boleh kamu sebutkan):`,
    ...lines,
    "Aturan: jangan menghitung atau mengarang harga, stok, total, diskon, atau COD. Jangan menawarkan jumlah melebihi stok tersedia. Total dan COD final hanya dari sistem order.",
  ].join("\n");
}

export function catalogUnavailablePrompt() {
  return "Katalog OMS sedang tidak dapat diambil. Jangan menyebutkan harga atau stok apa pun; sampaikan dengan santai bahwa kamu cek dulu ke tim.";
}
