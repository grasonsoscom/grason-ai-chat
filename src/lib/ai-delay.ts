// Delayed AI replies: a human CS does not answer in two seconds. An inbound
// message schedules the reply at a random moment in the agent's range; later
// messages during the wait are answered together in that one reply.
//
// The due time is stored on the conversation, so a server restart does not
// lose a pending reply: the sweeper (started from instrumentation.ts, and the
// OMS cron as a fallback) sends every reply that is due.
import { db } from "./db";

/** Upper bound for the setting: 5 minutes. */
export const MAX_REPLY_DELAY_SEC = 300;

export function randomDelaySec(minSec: number, maxSec: number, random = Math.random) {
  const lo = Math.max(0, Math.min(minSec, maxSec));
  const hi = Math.min(MAX_REPLY_DELAY_SEC, Math.max(minSec, maxSec));
  if (hi <= 0) return 0;
  return Math.round(lo + random() * (hi - lo));
}

/**
 * Schedules a delayed reply unless one is already pending (the earliest due
 * time wins, so a chatty customer is not kept waiting longer).
 */
export async function scheduleAiReply(conversationId: number, delaySec: number) {
  const dueAt = new Date(Date.now() + delaySec * 1000);
  await db.conversation.updateMany({ where: { id: conversationId, aiReplyDueAt: null }, data: { aiReplyDueAt: dueAt } });
}

/** Staff took over (manual reply or AI switched off): drop the pending reply. */
export async function cancelAiReply(conversationId: number) {
  await db.conversation.updateMany({ where: { id: conversationId, aiReplyDueAt: { not: null } }, data: { aiReplyDueAt: null } });
}

/**
 * Sends replies that are due. Each conversation is claimed with a
 * compare-and-set on its due time, so overlapping sweeps never reply twice.
 */
export async function processDueAiReplies(limit = 10) {
  const due = await db.conversation.findMany({
    where: { aiReplyDueAt: { lte: new Date() } },
    select: { id: true, aiReplyDueAt: true },
    orderBy: { aiReplyDueAt: "asc" },
    take: limit,
  });

  let replied = 0;
  for (const conv of due) {
    const claimed = await db.conversation.updateMany({
      where: { id: conv.id, aiReplyDueAt: conv.aiReplyDueAt },
      data: { aiReplyDueAt: null },
    });
    if (!claimed.count) continue;
    const current = await db.conversation.findUnique({ where: { id: conv.id }, select: { mode: true } });
    if (current?.mode !== "ai") continue; // staff took over while waiting
    // Imported lazily: messaging imports this module.
    const { aiRespond } = await import("./messaging");
    try {
      await aiRespond(conv.id);
      replied++;
    } catch (e) {
      console.error(`[ai-delay] reply for conversation ${conv.id} failed:`, (e as Error).message);
    }
  }
  return replied;
}

let sweeper: ReturnType<typeof setInterval> | null = null;

/** Long-running servers (pm2): check for due replies every 15 seconds. */
export function startAiReplySweeper(intervalMs = 15_000) {
  if (sweeper) return;
  let running = false;
  sweeper = setInterval(() => {
    if (running) return;
    running = true;
    processDueAiReplies()
      .catch((e) => console.error("[ai-delay] sweep failed:", (e as Error).message))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  sweeper.unref?.();
}
