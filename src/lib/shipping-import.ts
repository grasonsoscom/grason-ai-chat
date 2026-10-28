// Parses the J&T rate workbook (sheets "J&T REG" and "J&T CARGO") into ShippingRate rows.
import ExcelJS from "exceljs";
import { db } from "./db";

type Row = { service: string; warehouse: string; city: string; district: string; price: number; tiers: string; sla: string };

function cell(v: ExcelJS.CellValue): unknown {
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] };
    if (o.result !== undefined) return o.result;
    if (o.richText) return o.richText.map((t) => t.text).join("");
    if (o.text !== undefined) return o.text;
  }
  return v;
}

const text = (v: ExcelJS.CellValue) => String(cell(v) ?? "").trim();

function int(v: ExcelJS.CellValue) {
  const raw = cell(v);
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Excel turns an SLA like "7-9" into a date (9 July); read it back as month-day. */
function sla(v: ExcelJS.CellValue) {
  const raw = cell(v);
  if (raw instanceof Date) return `${raw.getUTCMonth() + 1}-${raw.getUTCDate()}`;
  return String(raw ?? "").trim();
}

function warehouseName(s: string) {
  const t = s.trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function parseReg(ws: ExcelJS.Worksheet): Row[] {
  // Row 2: "No", "NAMA KAB/KOTA", "KECAMATAN", <warehouse>...
  const header = ws.getRow(2);
  const cols: { col: number; warehouse: string }[] = [];
  header.eachCell((c, col) => { if (col >= 4 && text(c.value)) cols.push({ col, warehouse: warehouseName(text(c.value)) }); });
  if (!cols.length) throw new Error(`Sheet "${ws.name}": kolom gudang tidak ditemukan di baris 2.`);
  const rows: Row[] = [];
  ws.eachRow((row, r) => {
    if (r < 3) return;
    const city = text(row.getCell(2).value), district = text(row.getCell(3).value);
    if (!city || !district) return;
    for (const { col, warehouse } of cols) {
      const price = int(row.getCell(col).value);
      if (price) rows.push({ service: "REG", warehouse, city, district, price, tiers: "", sla: "" });
    }
  });
  return rows;
}

function tierMax(label: string) {
  // "10-50 KG" -> 50, ">300 KG" -> null (no upper bound)
  if (label.startsWith(">")) return null;
  const m = label.match(/-\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

function parseCargo(ws: ExcelJS.Worksheet): Row[] {
  // Row 2: warehouse per column; row 3: "0-10 KG", "10-50 KG", ..., "SLA".
  const groups = new Map<string, { base?: number; tiers: { col: number; max: number | null }[]; sla?: number }>();
  ws.getRow(3).eachCell((c, col) => {
    if (col < 3) return;
    const warehouse = warehouseName(text(ws.getRow(2).getCell(col).value));
    const label = text(c.value).toUpperCase();
    if (!warehouse || !label) return;
    const g = groups.get(warehouse) ?? { tiers: [] };
    if (label === "SLA") g.sla = col;
    else if (/^0\s*-/.test(label)) g.base = col;
    else g.tiers.push({ col, max: tierMax(label) });
    groups.set(warehouse, g);
  });
  if (![...groups.values()].some((g) => g.base)) throw new Error(`Sheet "${ws.name}": kolom "0-10 KG" tidak ditemukan di baris 3.`);
  const rows: Row[] = [];
  ws.eachRow((row, r) => {
    if (r < 4) return;
    const city = text(row.getCell(2).value);
    if (!city) return;
    for (const [warehouse, g] of groups) {
      const price = g.base ? int(row.getCell(g.base).value) : null;
      if (!price) continue;
      const tiers = g.tiers.map((t) => [t.max, int(row.getCell(t.col).value)]).filter(([, v]) => v);
      rows.push({ service: "CARGO", warehouse, city, district: "", price, tiers: JSON.stringify(tiers), sla: g.sla ? sla(row.getCell(g.sla).value) : "" });
    }
  });
  return rows;
}

export async function parseShippingWorkbook(data: ArrayBuffer | Buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data as ArrayBuffer);
  } catch {
    throw new Error("File tidak bisa dibaca. Pastikan formatnya .xlsx.");
  }
  const reg = wb.worksheets.find((ws) => /REG/i.test(ws.name));
  const cargo = wb.worksheets.find((ws) => /CARGO/i.test(ws.name));
  if (!reg && !cargo) throw new Error('Sheet "J&T REG" atau "J&T CARGO" tidak ditemukan.');
  return [...(reg ? parseReg(reg) : []), ...(cargo ? parseCargo(cargo) : [])];
}

/** Replaces all stored rates with the workbook's content. */
export async function importShippingWorkbook(data: ArrayBuffer | Buffer, fileName: string) {
  const rows = await parseShippingWorkbook(data);
  if (!rows.length) throw new Error("Tidak ada tarif yang bisa dibaca dari file ini.");
  await db.$transaction([
    db.shippingRate.deleteMany(),
    db.shippingRate.createMany({ data: rows }),
    db.account.update({ where: { id: 1 }, data: { shippingFile: fileName, shippingAt: new Date() } }),
  ]);
  return {
    reg: rows.filter((r) => r.service === "REG").length,
    cargo: rows.filter((r) => r.service === "CARGO").length,
  };
}
