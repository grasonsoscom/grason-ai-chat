// Usage: npm run ongkir:import -- "path/to/JNT.xlsx"
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { importShippingWorkbook } from "../src/lib/shipping-import";
import { db } from "../src/lib/db";

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: npm run ongkir:import -- "path/to/file.xlsx"');
  const { reg, cargo } = await importShippingWorkbook(await readFile(file), basename(file));
  console.log(`Imported ${reg} REG rates and ${cargo} CARGO rates.`);
}

main()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => db.$disconnect());
