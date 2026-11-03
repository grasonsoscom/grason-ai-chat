// Shipping cost resolution for AI replies and automatic orders.
// RajaOngkir is tried first; the imported J&T rate table remains the fallback.
import { db } from "./db";
import {
  fetchDestinations,
  fetchDomesticCost,
  getRajaOngkirConfig,
  type DomesticDestination,
} from "./rajaongkir";

export type OngkirQuote = {
  cost: number;
  courier: string;
  service: string;
  etd: string;
  destination: string;
  weight: number;
  source: "rajaongkir" | "jnt";
};

export type AddressForQuote = {
  kecamatan?: string;
  kota: string;
  provinsi?: string;
  kode_pos?: string;
  weight?: number;
};

function norm(value: string | undefined | null) {
  return (value ?? "")
    .toUpperCase()
    .replace(/\b(KECAMATAN|KEC|KABUPATEN|KAB|KOTA)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function scoreDestination(d: DomesticDestination, input: AddressForQuote) {
  const city = norm(input.kota);
  const district = norm(input.kecamatan);
  const province = norm(input.provinsi);
  const dCity = norm(d.city_name);
  const dDistrict = norm(d.district_name);
  let score = 0;
  if (city && (dCity === city || dCity.includes(city) || city.includes(dCity))) score += 4;
  if (district && (dDistrict === district || dDistrict.includes(district) || district.includes(dDistrict))) score += 4;
  if (province && norm(d.province_name).includes(province)) score += 1;
  if (input.kode_pos && d.zip_code === input.kode_pos) score += 2;
  return score;
}

/**
 * Best destination among search results, or null when none matches the address: a
 * same-named village in another province must not be quoted (e.g. "Surabaya" in Lampung).
 */
export function pickDestination(rows: DomesticDestination[], input: AddressForQuote): DomesticDestination | null {
  let best: DomesticDestination | null = null;
  // A province match alone (score 1) is not enough: city, kecamatan or postal code must match.
  let bestScore = 1;
  for (const row of rows) {
    const score = scoreDestination(row, input);
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return best;
}

function hasWord(text: string, word: string) {
  return Boolean(word) && ` ${text} `.includes(` ${word} `);
}

/**
 * Free-text query ("cilodong depok", "surabaya"): the kab/kota must be named in the
 * query; a kecamatan named too breaks ties between rows of the same city.
 */
export function pickDestinationByText(rows: DomesticDestination[], query: string): DomesticDestination | null {
  const q = norm(query);
  let best: DomesticDestination | null = null;
  let bestScore = 0;
  for (const row of rows) {
    if (!hasWord(q, norm(row.city_name))) continue;
    const score = 4 + (hasWord(q, norm(row.district_name)) ? 2 : 0) + (hasWord(q, norm(row.subdistrict_name)) ? 1 : 0);
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return best;
}

async function rajaQuoteForDestination(
  destination: DomesticDestination,
  weight: number,
): Promise<OngkirQuote | null> {
  const config = await getRajaOngkirConfig();
  if (!config) return null;
  const rows = await fetchDomesticCost(config.apiKey, {
    origin: config.originId,
    destination: destination.id,
    weight,
    courier: config.courier,
  });
  const best = rows[0];
  if (!best) return null;
  return {
    cost: best.cost,
    courier: best.name || best.code.toUpperCase(),
    service: best.service,
    etd: best.etd,
    destination: destination.label,
    weight,
    source: "rajaongkir",
  };
}

/** RajaOngkir quote for a free-text destination (used by the AI prompt). */
export async function rajaQuoteByText(query: string, weight?: number): Promise<OngkirQuote | null> {
  const config = await getRajaOngkirConfig();
  if (!config) return null;
  const q = query.trim();
  if (q.length < 2) return null;
  try {
    const rows = await fetchDestinations(config.apiKey, q, { limit: 20 });
    const destination = pickDestinationByText(rows, q);
    if (!destination) return null;
    return await rajaQuoteForDestination(destination, weight ?? config.weight);
  } catch (e) {
    console.error("[rajaongkir] quote failed:", (e as Error).message);
    return null;
  }
}

/** Exact-address quote with J&T fallback; used before creating an automatic order. */
export async function quoteOngkir(input: AddressForQuote): Promise<OngkirQuote | null> {
  const config = await getRajaOngkirConfig();
  const weight = input.weight ?? config?.weight ?? 1000;
  const queries = [
    [input.kecamatan, input.kota].filter(Boolean).join(" "),
    [input.kota, input.provinsi].filter(Boolean).join(" "),
    input.kode_pos ?? "",
    input.kota,
  ].map((q) => q.trim()).filter((q, i, all) => q.length >= 2 && all.indexOf(q) === i);

  if (config) {
    for (const query of queries) {
      try {
        const rows = await fetchDestinations(config.apiKey, query, { limit: 20 });
        const destination = pickDestination(rows, input);
        if (!destination) continue;
        const quote = await rajaQuoteForDestination(destination, weight);
        if (quote) return quote;
      } catch (e) {
        console.error("[rajaongkir] address quote failed:", (e as Error).message);
      }
    }
  }

  // J&T Excel fallback (REG only), cheapest warehouse for the matched area.
  const rows = await db.shippingRate.findMany({ where: { service: "REG" } });
  const district = norm(input.kecamatan);
  const city = norm(input.kota);
  let matches = district
    ? rows.filter((r) => norm(r.district).split(" ")[0] === district || norm(r.district).includes(district))
    : [];
  if (!matches.length && city) {
    matches = rows.filter((r) => {
      const rc = norm(r.city);
      return rc === city || rc.includes(city) || city.includes(rc);
    });
  }
  const best = matches.sort((a, b) => a.price - b.price)[0];
  if (!best) return null;
  return {
    cost: best.price,
    courier: "J&T",
    service: "REG",
    etd: "",
    destination: `${best.district}, ${best.city}`,
    weight,
    source: "jnt",
  };
}
