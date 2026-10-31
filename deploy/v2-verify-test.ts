import { db } from "../src/lib/db";
import { isoUtc } from "../src/lib/oms/normalize";
import { submitVerification } from "../src/lib/oms/orders";

async function main() {
  const local = await db.omsOrder.findFirst({
    where: { status: "baru" },
    orderBy: { id: "desc" },
  });
  if (!local) throw new Error("No new OMS order found.");

  const order = await submitVerification(local.id, {
    dikonfirmasi_at: isoUtc(),
    nilai_cod_dikonfirmasi: local.nilaiCod,
    catatan: "Uji verifikasi v2 staging",
  });
  const updated = await db.omsOrder.findUniqueOrThrow({ where: { id: local.id } });

  console.log({
    nomor: order.nomor,
    oms_status: order.status,
    total: order.total,
    nilai_cod: order.nilai_cod,
    local_status: updated.status,
  });

  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
