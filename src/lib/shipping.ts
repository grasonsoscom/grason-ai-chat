// Finds J&T rates for places mentioned in a chat and formats them for the AI prompt.
import { db } from "./db";
import type { ChatTurn } from "./ai";

type Rate = { warehouse: string; city: string; district: string; price: number; tiers: [number | null, number][]; sla: string };

type Index = {
  version: string;
  districts: Map<string, Rate[]>; // normalized kecamatan -> cheapest REG rate per city
  cities: Map<string, string>; // normalized kab/kota (or alias) -> REG city name
  regByCity: Map<string, Rate[]>;
  cargo: Map<string, Rate>; // normalized city -> cheapest CARGO rate
  maxWords: number;
};

const g = globalThis as { shippingIndex?: Index };

export function norm(s: string) {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

/** "SUKAJADI-BDO" -> "SUKAJADI": the short suffix only disambiguates same-named kecamatan. */
function districtKey(d: string) {
  return norm(d.replace(/-[A-Z]{2,3}$/i, ""));
}

function cityKeys(c: string) {
  const n = norm(c);
  const bare = n.replace(/^(KAB|KABUPATEN|KOTA)\s+/, "");
  return bare && bare !== n ? [n, bare] : [n];
}

const cheaper = (a: Rate | undefined, b: Rate) => (!a || b.price < a.price ? b : a);

/** Cargo sheet spells some cities differently ("TULUNG AGUNG", "KAB. TANGERANG"). */
const compact = (s: string) => norm(s).replace(/ /g, "");

function cargoFor(index: Index, city: string) {
  return index.cargo.get(compact(city)) ?? index.cargo.get(compact(cityKeys(city).at(-1)!));
}

async function loadIndex(): Promise<Index | null> {
  const agg = await db.shippingRate.aggregate({ _max: { id: true }, _count: true });
  if (!agg._count) return null;
  const version = `${agg._max.id}:${agg._count}`;
  if (g.shippingIndex?.version === version) return g.shippingIndex;

  const rows = await db.shippingRate.findMany();
  const regBest = new Map<string, Rate>(); // city|district -> cheapest warehouse
  const cargo = new Map<string, Rate>();
  for (const r of rows) {
    const rate: Rate = { warehouse: r.warehouse, city: r.city, district: r.district, price: r.price, tiers: r.tiers ? JSON.parse(r.tiers) : [], sla: r.sla };
    if (r.service === "REG") {
      const k = `${r.city}|${r.district}`;
      regBest.set(k, cheaper(regBest.get(k), rate));
    } else {
      const k = compact(r.city);
      cargo.set(k, cheaper(cargo.get(k), rate));
    }
  }
  const districts = new Map<string, Rate[]>();
  const cities = new Map<string, string>();
  const regByCity = new Map<string, Rate[]>();
  let maxWords = 1;
  const add = (k: string) => { maxWords = Math.max(maxWords, k.split(" ").length); };
  for (const rate of regBest.values()) {
    const dk = districtKey(rate.district);
    districts.set(dk, [...(districts.get(dk) ?? []), rate]);
    add(dk);
    for (const ck of cityKeys(rate.city)) { if (!cities.has(ck)) cities.set(ck, rate.city); add(ck); }
    regByCity.set(rate.city, [...(regByCity.get(rate.city) ?? []), rate]);
  }
  for (const [alias, city] of Object.entries(CITY_ALIASES)) if (regByCity.has(city) && !cities.has(alias)) cities.set(alias, city);
  g.shippingIndex = { version, districts, cities, regByCity, cargo, maxWords };
  return g.shippingIndex;
}

const INTENT = /\b(ongkir|ongkos|\w*kirim|pengiriman|ekspedisi|kurir|cargo|kargo)|\b(jnt|j&t|j n t|kecamatan|kec|kabupaten|kab|kota|alamat)\b/i;

// Everyday names for places whose kab/kota is written differently in the J&T table.
const CITY_ALIASES: Record<string, string> = { JOGJA: "YOGYAKARTA", JOGJAKARTA: "YOGYAKARTA", JOGYAKARTA: "YOGYAKARTA" };

// Short kecamatan names that are also everyday words; only trusted after "kec"/"kecamatan".
const COMMON = new Set(["BARU", "RAYA", "JAYA", "KAMU", "IBU", "AYAH", "AREA", "LUAS", "KILO", "BATU", "KOTA", "GIRI", "PURI", "TOBA", "BUKA", "SALE", "PACE", "BINA", "MANE", "LAU", "ALAS", "UTAN", "KAI"]);

/** Longest-first scan: returns kecamatan matches and kab/kota names mentioned in the text. */
function scan(text: string, index: Index) {
  const words = norm(text).split(" ").filter(Boolean);
  const districts: Rate[][] = [];
  const cities = new Set<string>();
  for (let i = 0; i < words.length; ) {
    const afterKec = i > 0 && /^(KEC|KECAMATAN)$/.test(words[i - 1]);
    let step = 1;
    for (let n = Math.min(index.maxWords, words.length - i); n >= 1; n--) {
      const key = words.slice(i, i + n).join(" ");
      const city = index.cities.get(key);
      if (city) cities.add(city);
      // "Bandung" is the city unless written as "kec Bandung" (a kecamatan in Serang has that name).
      const list = city && !afterKec ? undefined : index.districts.get(key);
      const ambiguousWord = key.length <= 4 || COMMON.has(key);
      const isDistrict = Boolean(list) && (afterKec || !ambiguousWord);
      if (isDistrict) districts.push(list!);
      if (city || isDistrict) { step = n; break; }
    }
    i += step;
  }
  return { districts, cities };
}

const rp = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

/** Cargo price for a weight: flat up to 10 kg, then per kg (rounded up) at the matching tier. */
export function cargoPrice(rate: Rate, kg: number) {
  if (kg <= 10) return rate.price;
  const tier = rate.tiers.find(([max]) => max === null || kg <= max);
  return tier ? Math.ceil(kg) * tier[1] : null;
}

function cargoLine(rate: Rate | undefined, kg: number | null) {
  if (!rate) return "J&T Cargo: tidak ada di data untuk kota ini.";
  const tiers = rate.tiers.map(([max, perKg], i) => {
    const min = i === 0 ? 10 : rate.tiers[i - 1][0];
    return `${max === null ? `>${min}` : `${min}-${max}`} kg ${rp(perKg)}/kg`;
  });
  const parts = [`J&T Cargo (gudang ${rate.warehouse}): sampai 10 kg ${rp(rate.price)}`, ...tiers];
  let line = parts.join("; ");
  if (rate.sla) line += `; estimasi ${rate.sla} hari`;
  if (kg) {
    const total = cargoPrice(rate, kg);
    if (total) line += `. Untuk ${kg} kg: ${rp(total)}`;
  }
  return line;
}

function weightOf(text: string) {
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*(kg|kilo)/i);
  const kg = m ? Number(m[1].replace(",", ".")) : NaN;
  return kg > 0 && kg < 10_000 ? kg : null;
}

/**
 * Looks at the latest customer messages for kecamatan / kab-kota names and returns a
 * prompt section with the matching rates, or null when nobody is asking about shipping.
 */
export async function shippingContext(turns: ChatTurn[]) {
  const recent = turns.slice(-6);
  if (!recent.some((t) => INTENT.test(t.text))) return null;
  const index = await loadIndex();
  if (!index) return null;

  const customer = recent.filter((t) => t.role === "user").slice(-3).map((t) => t.text);
  const text = customer.join(" \n ");
  // The newest message naming a place wins ("kalau ke jogja?" replaces an earlier Sukajadi).
  // Older messages only fill in the kab/kota for a kecamatan named on its own.
  const scans = customer.map((t) => scan(t, index)).reverse();
  const latest = scans.find((s) => s.districts.length || s.cities.size) ?? { districts: [], cities: new Set<string>() };
  const districts = latest.districts;
  const mentionedCities = latest.cities.size || !districts.length ? latest.cities : new Set(scans.flatMap((s) => [...s.cities]));

  let matches: Rate[] = [];
  for (const list of districts) {
    const narrowed = mentionedCities.size ? list.filter((r) => mentionedCities.has(r.city)) : list;
    matches.push(...(narrowed.length ? narrowed : list));
  }
  matches = [...new Map(matches.map((m) => [`${m.city}|${m.district}`, m])).values()];
  // With a kab/kota named, prefer kecamatan inside it over same-named ones elsewhere.
  const inCity = matches.filter((m) => mentionedCities.has(m.city));
  if (inCity.length) matches = inCity;

  const kg = weightOf(text);
  const lines: string[] = [];
  if (matches.length && matches.length <= 6) {
    for (const m of matches) {
      lines.push(`- Kec. ${districtKey(m.district)}, ${m.city}\n  J&T REG: ${rp(m.price)} per paket (gudang ${m.warehouse})\n  ${cargoLine(cargoFor(index, m.city), kg)}`);
    }
    if (matches.length > 1) lines.push("Ada beberapa kecamatan yang cocok: tanyakan kab/kota tujuannya kalau belum jelas.");
  } else if (matches.length > 6) {
    lines.push(`Nama kecamatan itu ada di ${matches.length} kab/kota (${[...new Set(matches.map((m) => m.city))].slice(0, 8).join(", ")}). Tanyakan kab/kota tujuannya.`);
  } else if (mentionedCities.size) {
    let varies = false;
    for (const city of [...mentionedCities].slice(0, 3)) {
      const regs = index.regByCity.get(city) ?? [];
      const lo = Math.min(...regs.map((r) => r.price)), hi = Math.max(...regs.map((r) => r.price));
      varies ||= lo !== hi;
      const reg = lo === hi ? `${rp(lo)} per paket untuk semua kecamatan` : `${rp(lo)} - ${rp(hi)} per paket tergantung kecamatan`;
      lines.push(`- ${city} (kecamatan belum disebut)\n  J&T REG: ${reg}\n  ${cargoLine(cargoFor(index, city), kg)}`);
    }
    if (varies) lines.push("Tanyakan kecamatan tujuannya supaya ongkir REG bisa dipastikan.");
  } else {
    lines.push("Pelanggan sepertinya menanyakan ongkir, tapi kecamatan/kota tujuannya belum dikenali. Tanyakan kecamatan dan kab/kota tujuannya.");
  }

  return [
    "Data ongkir J&T dari database (dicari otomatis dari pesan terbaru pelanggan). Angka di sini boleh kamu sampaikan dan berlaku walaupun di balasan sebelumnya kamu bilang belum ada datanya; jangan mengubah atau mengarang angka lain:",
    ...lines,
    "Cara menyampaikan: sebutkan ongkir J&T REG (per paket) dan J&T Cargo (untuk kiriman berat) supaya pelanggan bisa memilih. " +
      "Estimasi waktu REG tidak ada di data, jadi jangan dijanjikan. Kalau berat kiriman belum jelas, sebut tarif Cargo sampai 10 kg saja.",
  ].join("\n");
}
