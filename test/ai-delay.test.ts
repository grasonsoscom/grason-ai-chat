import { beforeEach, describe, expect, it, vi } from "vitest";

// Conversations with a pending AI reply; updateMany is a compare-and-set.
type Conv = { id: number; mode: string; aiReplyDueAt: Date | null };
const convs = new Map<number, Conv>();

vi.mock("@/lib/db", () => ({
  db: {
    conversation: {
      findMany: async () =>
        [...convs.values()]
          .filter((c) => c.aiReplyDueAt && c.aiReplyDueAt <= new Date())
          .map((c) => ({ id: c.id, aiReplyDueAt: c.aiReplyDueAt })),
      findUnique: async ({ where }: { where: { id: number } }) => convs.get(where.id) ?? null,
      updateMany: async ({ where, data }: { where: { id: number; aiReplyDueAt: unknown }; data: Partial<Conv> }) => {
        await Promise.resolve();
        const c = convs.get(where.id);
        if (!c) return { count: 0 };
        const w = where.aiReplyDueAt as Date | null | { not: null };
        const ok =
          w === null
            ? c.aiReplyDueAt === null
            : w instanceof Date
              ? c.aiReplyDueAt?.getTime() === w.getTime()
              : c.aiReplyDueAt !== null;
        if (!ok) return { count: 0 };
        Object.assign(c, data);
        return { count: 1 };
      },
    },
  },
}));

const aiRespond = vi.fn(async (_id: number) => "replied");
vi.mock("@/lib/messaging", () => ({ aiRespond }));

const { cancelAiReply, processDueAiReplies, randomDelaySec, scheduleAiReply } = await import("@/lib/ai-delay");

beforeEach(() => {
  convs.clear();
  aiRespond.mockClear();
});

describe("randomDelaySec", () => {
  it("stays inside the range", () => {
    expect(randomDelaySec(60, 180, () => 0)).toBe(60);
    expect(randomDelaySec(60, 180, () => 1)).toBe(180);
    expect(randomDelaySec(60, 180, () => 0.5)).toBe(120);
  });

  it("is 0 when the delay is off and caps at 5 minutes", () => {
    expect(randomDelaySec(0, 0)).toBe(0);
    expect(randomDelaySec(60, 900, () => 1)).toBe(300);
  });

  it("tolerates a swapped range", () => {
    expect(randomDelaySec(180, 60, () => 0)).toBe(60);
  });
});

describe("delayed replies", () => {
  it("keeps the first due time when more messages arrive", async () => {
    convs.set(1, { id: 1, mode: "ai", aiReplyDueAt: null });
    await scheduleAiReply(1, 60);
    const first = convs.get(1)!.aiReplyDueAt!;
    await scheduleAiReply(1, 240);
    expect(convs.get(1)!.aiReplyDueAt).toBe(first);
  });

  it("replies once when due, even with overlapping sweeps", async () => {
    convs.set(1, { id: 1, mode: "ai", aiReplyDueAt: new Date(Date.now() - 1000) });
    const [a, b] = await Promise.all([processDueAiReplies(), processDueAiReplies()]);
    expect(a + b).toBe(1);
    expect(aiRespond).toHaveBeenCalledTimes(1);
    expect(convs.get(1)!.aiReplyDueAt).toBeNull();
  });

  it("does not reply before the due time", async () => {
    convs.set(1, { id: 1, mode: "ai", aiReplyDueAt: new Date(Date.now() + 60_000) });
    expect(await processDueAiReplies()).toBe(0);
    expect(aiRespond).not.toHaveBeenCalled();
  });

  it("skips conversations that staff took over", async () => {
    convs.set(1, { id: 1, mode: "staf", aiReplyDueAt: new Date(Date.now() - 1000) });
    expect(await processDueAiReplies()).toBe(0);
    expect(aiRespond).not.toHaveBeenCalled();
  });

  it("drops the pending reply when staff answers", async () => {
    convs.set(1, { id: 1, mode: "ai", aiReplyDueAt: new Date(Date.now() + 60_000) });
    await cancelAiReply(1);
    expect(convs.get(1)!.aiReplyDueAt).toBeNull();
  });
});
