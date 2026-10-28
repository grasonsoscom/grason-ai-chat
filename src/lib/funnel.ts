import { db } from "./db";

/**
 * Re-sequences a funnel so levels are 1..n, stages inside each level are 1..m,
 * and every stage's global `number` follows level order then stage order.
 * Call after any insert, delete, or move.
 */
export async function renumberFunnel(funnelId: number) {
  const levels = await db.funnelLevel.findMany({
    where: { funnelId },
    orderBy: [{ order: "asc" }, { id: "asc" }],
    include: { stages: { orderBy: [{ order: "asc" }, { id: "asc" }] } },
  });
  let number = 1;
  const ops = [];
  for (const [li, level] of levels.entries()) {
    ops.push(db.funnelLevel.update({ where: { id: level.id }, data: { order: li + 1 } }));
    for (const [si, stage] of level.stages.entries()) {
      ops.push(db.funnelStage.update({ where: { id: stage.id }, data: { order: si + 1, number: number++ } }));
    }
  }
  await db.$transaction(ops);
}
