// Customer segment helpers plus re-exports of the pure promo rules.
// The pure rules live in promo-quote.ts so client components can import them.
import { db } from "./db";
import type { Segment } from "./promo-quote";

export * from "./promo-quote";

// A chat older than this means the customer has talked to us before.
const REPEAT_AFTER_DAYS = 7;

/** Staff-set type wins; otherwise RO when the customer chatted more than a week ago. */
export async function customerSegment(customerId: number): Promise<Segment> {
  const c = await db.customer.findUnique({ where: { id: customerId }, include: { conversation: true } });
  if (!c) return "nc";
  if (c.segment === "nc" || c.segment === "ro" || c.segment === "reseller") return c.segment;
  if (!c.conversation) return "nc";
  const cutoff = new Date(Date.now() - REPEAT_AFTER_DAYS * 86_400_000);
  const old = await db.message.findFirst({
    where: { conversationId: c.conversation.id, direction: "in", createdAt: { lt: cutoff } },
  });
  return old ? "ro" : "nc";
}
