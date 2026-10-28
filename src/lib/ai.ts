import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";

const MODEL = "claude-opus-5-5";

export class AiNotConfiguredError extends Error {
  constructor() {
    super(
      process.env.AI_PROVIDER === "openai"
        ? "AI belum dikonfigurasi. Isi OPENAI_BASE_URL, OPENAI_API_KEY, dan OPENAI_MODEL di file .env lalu jalankan ulang server."
        : "AI belum dikonfigurasi. Isi ANTHROPIC_API_KEY di file .env lalu jalankan ulang server.",
    );
  }
}

export type ChatTurn = { role: "user" | "assistant"; text: string };

type AgentWithContext = NonNullable<Awaited<ReturnType<typeof loadAgent>>>;

export function loadAgent(agentId: number) {
  return db.aiAgent.findUnique({
    where: { id: agentId },
    include: {
      products: { include: { variants: true } },
      funnel: { include: { levels: { include: { stages: true }, orderBy: { order: "asc" } } } },
    },
  });
}

/**
 * Builds the system prompt. The agent's Deskripsi is business configuration
 * written by the owner and is passed through verbatim.
 */
export function buildSystemPrompt(agent: AgentWithContext) {
  const parts: string[] = [
    `Kamu adalah "${agent.name}", agen ${agent.baseLearning} untuk bisnis yang berjualan lewat WhatsApp.`,
    "Balas dalam Bahasa Indonesia, singkat dan cocok untuk chat WhatsApp (tanpa format markdown).",
    `Batasi balasan sekitar ${agent.maxReplyChars} karakter.`,
  ];
  if (agent.description.trim()) parts.push(`Instruksi dari pemilik bisnis:\n${agent.description.trim()}`);
  if (agent.personality.trim()) parts.push(`Kepribadian:\n${agent.personality.trim()}`);
  if (agent.products.length) {
    const list = agent.products
      .map((p) => {
        const variants = p.variants.map((v) => `  - ${v.name}: Rp${v.price.toLocaleString("id-ID")}`).join("\n");
        return [`* ${p.name}`, p.description && `  ${p.description}`, p.aiPrompt && `  Catatan: ${p.aiPrompt}`, variants]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n");
    parts.push(`Produk yang kamu tangani (jangan mengarang info di luar ini):\n${list}`);
  }
  if (agent.funnel) {
    const stages = agent.funnel.levels.flatMap((l) => l.stages).sort((a, b) => a.number - b.number);
    parts.push(
      `Tahapan funnel pelanggan:\n${stages.map((s) => `${s.number}. ${s.name}: ${s.description}`).join("\n")}`,
    );
  }
  parts.push(
    "Jangan menjanjikan atau mengarang hal yang tidak tertulis di instruksi dan data produk di atas, " +
      "misalnya COD, ongkos kirim, area pengiriman, metode pembayaran, promo, diskon, atau stok. " +
      "Kalau pelanggan menanyakannya dan infonya tidak ada, jangan bilang bisa atau tidak bisa: " +
      "sampaikan dengan santai bahwa kamu cek dulu ke tim, dan staf kami akan segera membantu.",
  );
  return parts.join("\n\n");
}

function toMessages(turns: ChatTurn[]): Anthropic.Beta.BetaMessageParam[] {
  // API requires the first turn to be the user and no trailing assistant (no prefill).
  const start = turns.findIndex((t) => t.role === "user");
  const trimmed = start === -1 ? [] : turns.slice(start);
  while (trimmed.length && trimmed[trimmed.length - 1].role === "assistant") trimmed.pop();
  return trimmed.map((t) => ({ role: t.role, content: t.text }));
}

/** "openai" = any OpenAI-compatible /chat/completions endpoint; default is Claude. */
function provider() {
  return process.env.AI_PROVIDER === "openai" ? "openai" : "anthropic";
}

export function isAiConfigured() {
  return provider() === "openai"
    ? Boolean(process.env.OPENAI_BASE_URL && process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL)
    : Boolean(process.env.ANTHROPIC_API_KEY);
}

/** `overrides` lets AI Response Test try unsaved Deskripsi/Kepribadian text. */
export async function generateReply(
  agentId: number,
  turns: ChatTurn[],
  overrides?: { description?: string; personality?: string },
) {
  if (!isAiConfigured()) throw new AiNotConfiguredError();
  const loaded = await loadAgent(agentId);
  if (!loaded) throw new Error("AI Agent tidak ditemukan.");
  const agent = { ...loaded, ...Object.fromEntries(Object.entries(overrides ?? {}).filter(([, v]) => v !== undefined)) };
  const messages = toMessages(turns);
  if (!messages.length) throw new Error("Belum ada pesan pelanggan untuk dibalas.");
  const system = buildSystemPrompt(agent);
  return provider() === "openai" ? callOpenAiCompatible(system, messages) : callClaude(system, messages);
}

type ChatCompletion = {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  error?: { message?: string };
};

async function callOpenAiCompatible(system: string, messages: Anthropic.Beta.BetaMessageParam[]) {
  const base = process.env.OPENAI_BASE_URL!.replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL,
        max_tokens: 2048,
        messages: [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role, content: m.content as string }))],
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new Error("Tidak dapat terhubung ke server AI. Cek OPENAI_BASE_URL atau koneksi internet.");
  }
  const json = (await res.json().catch(() => ({}))) as ChatCompletion;
  if (res.status === 401 || res.status === 403) throw new Error("API key AI tidak valid.");
  if (res.status === 429) throw new Error("Batas permintaan AI tercapai. Coba lagi sebentar.");
  if (!res.ok) throw new Error(`Gagal menghubungi AI (${res.status})${json.error?.message ? `: ${json.error.message}` : ""}.`);
  // Reasoning models may inline their thinking; customers must only see the answer.
  const text = (json.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (!text) throw new Error("AI tidak menghasilkan balasan.");
  return text;
}

async function callClaude(system: string, messages: Anthropic.Beta.BetaMessageParam[]) {
  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system,
      messages,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      // Server-side refusal fallback; not yet in the SDK's typed params.
      ...({ fallbacks: "default" } as object),
    });
    if (response.stop_reason === "refusal") {
      throw new Error("AI menolak membalas pesan ini. Coba tangani secara manual.");
    }
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!text) throw new Error("AI tidak menghasilkan balasan.");
    return text;
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new Error("API key Claude tidak valid.");
    if (error instanceof Anthropic.RateLimitError) throw new Error("Batas permintaan AI tercapai. Coba lagi sebentar.");
    if (error instanceof Anthropic.APIError) throw new Error(`Gagal menghubungi AI (${error.status}).`);
    throw error;
  }
}
