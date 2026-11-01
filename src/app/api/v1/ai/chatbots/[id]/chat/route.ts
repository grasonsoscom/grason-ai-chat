import { authenticateApiToken } from "@/lib/api/auth";
import { ApiError, handleApi, notFound, ok, pathId, readJson, requiredString } from "@/lib/api/http";
import { AiNotConfiguredError, generateReply, isAiConfigured, type ChatTurn } from "@/lib/ai";
import { assertCoins, COIN_COSTS, InsufficientCoinsError, spendCoins } from "@/lib/coins";
import { db } from "@/lib/db";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    await authenticateApiToken(req, "ai:write");
    const id = pathId((await params).id);
    const agent = await db.aiAgent.findUnique({ where: { id } });
    if (!agent) throw notFound("Chatbot not found.");
    if (!agent.active) throw new ApiError(422, { message: "Chatbot sedang nonaktif." });
    if (!(await isAiConfigured())) throw new ApiError(503, { error: "AI belum dikonfigurasi di server." });

    const body = await readJson<Record<string, unknown>>(req);
    const message = requiredString(body.message, "message");

    const history: ChatTurn[] = Array.isArray(body.history)
      ? body.history
          .slice(-30)
          .map((turn) => {
            if (!turn || typeof turn !== "object") return null;
            const item = turn as { role?: unknown; content?: unknown; text?: unknown };
            const text = typeof item.content === "string" ? item.content : typeof item.text === "string" ? item.text : "";
            if (!text.trim()) return null;
            return { role: item.role === "assistant" ? ("assistant" as const) : ("user" as const), text };
          })
          .filter((turn): turn is ChatTurn => Boolean(turn))
      : [];

    try {
      await assertCoins(COIN_COSTS.aiReply);
      // The API returns text only, so the AI is not offered testimonial media here.
      const reply = await generateReply(agent.id, [...history, { role: "user", text: message }], undefined, undefined, {
        media: [],
      });
      await spendCoins(COIN_COSTS.aiReply, `API chatbot (${agent.name})`);
      return ok({ reply });
    } catch (e) {
      if (e instanceof InsufficientCoinsError) {
        throw new ApiError(402, { error: e.message, needed: e.needed, current: e.balance });
      }
      if (e instanceof AiNotConfiguredError) {
        throw new ApiError(503, { error: e.message });
      }
      throw new ApiError(502, { error: (e as Error).message });
    }
  });
}
