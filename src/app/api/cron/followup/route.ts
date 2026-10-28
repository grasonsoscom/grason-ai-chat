import { runFollowups } from "@/lib/messaging";

/** Call periodically (e.g. every 15 minutes) with header x-webhook-secret. */
export async function POST(req: Request) {
  const secret = process.env.INCOMING_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-webhook-secret") !== secret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json({ sent: await runFollowups() });
}
