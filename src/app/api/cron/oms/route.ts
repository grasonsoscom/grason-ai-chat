import { pollOpenOrders } from "@/lib/oms/orders";
import { processOutbox } from "@/lib/oms/outbox";
import { processPendingOmsEvents } from "@/lib/oms/webhook";

async function run() {
  const outbox = await processOutbox(50).catch((e) => {
    console.error("[oms] outbox run failed:", (e as Error).message);
    return 0;
  });
  const events = await processPendingOmsEvents(20).catch((e) => {
    console.error("[oms] webhook retry run failed:", (e as Error).message);
    return 0;
  });
  const polled = await pollOpenOrders(50).catch((e) => {
    console.error("[oms] order polling failed:", (e as Error).message);
    return 0;
  });
  return Response.json({ outbox, events, polled });
}

/** External scheduler: POST with x-webhook-secret (e.g. every 15 minutes). */
export async function POST(req: Request) {
  const secret = process.env.INCOMING_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-webhook-secret") !== secret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run();
}

/** Vercel Cron: GET with "Authorization: Bearer $CRON_SECRET". */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run();
}
