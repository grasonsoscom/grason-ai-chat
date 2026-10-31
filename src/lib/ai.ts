import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { getAiConfig, type AiConfig } from "./ai-settings";
import type { Segment } from "./promo";
import { shippingContext } from "./shipping";
import { catalogPrompt, catalogUnavailablePrompt, getOmsCatalog } from "./oms/catalog";
import { omsConfigured } from "./oms/client";

export class AiNotConfiguredError extends Error {
  constructor() {
    super(
      "AI belum dikonfigurasi. Buka Integrasi → AI / LLM di web untuk mengisi provider, model, dan API key, " +
        "atau isi ANTHROPIC_API_KEY / OPENAI_API_KEY di .env.",
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

const rp = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

/** "1 box (200 gram): harga normal Rp85.000, harga promo Rp42.000" */
function variantLine(v: { name: string; weight: number; price: number; salePrice: number | null }) {
  const name = v.weight ? `${v.name} (${v.weight.toLocaleString("id-ID")} gram)` : v.name;
  return v.salePrice !== null
    ? `${name}: harga normal ${rp(v.price)}, harga promo ${rp(v.salePrice)} (harga yang dibayar pelanggan)`
    : `${name}: ${rp(v.price)}`;
}

/**
 * Builds the system prompt. The agent's Deskripsi is business configuration
 * written by the owner and is passed through verbatim.
 */
export function buildSystemPrompt(
  agent: AgentWithContext,
  shipping?: string | null,
  omsCatalog?: string | null,
  omsEnabled = false,
) {
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
        // With OMS the catalog is the only allowed price source, so local
        // variant prices are omitted from the prompt.
        const variants = omsEnabled
          ? ""
          : p.variants.map((v) => `  - ${variantLine(v)}`).join("\n");
        return [`* ${p.name}`, p.description && `  ${p.description}`, p.aiPrompt && `  Catatan: ${p.aiPrompt}`, variants]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n");
    parts.push(
      omsEnabled
        ? `Catatan produk dari pemilik bisnis (nama dan deskripsi saja; harga dan stok WAJIB memakai katalog OMS di bawah):\n${list}`
        : `Produk yang kamu tangani (jangan mengarang info di luar ini):\n${list}`,
    );
  }
  if (agent.funnel) {
    const stages = agent.funnel.levels.flatMap((l) => l.stages).sort((a, b) => a.number - b.number);
    parts.push(
      `Tahapan funnel pelanggan:\n${stages.map((s) => `${s.number}. ${s.name}: ${s.description}`).join("\n")}`,
    );
  }
  if (shipping) parts.push(shipping);
  if (omsEnabled) {
    parts.push(omsCatalog ?? catalogUnavailablePrompt());
    parts.push(
      "Kamu tidak membuat pesanan sendiri. Jika pembeli siap membeli, minta nama penerima, alamat lengkap, " +
        "dan konfirmasi metode bayar; lalu sampaikan staf akan membuatkan pesanan. " +
        "Jangan pernah bilang pesanan sudah dibuat sebelum staf mengonfirmasi. " +
        "Jangan menghitung total, diskon, atau nilai COD final; angka final berasal dari sistem order.",
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

export async function isAiConfigured() {
  return Boolean(await getAiConfig());
}

/** `overrides` lets AI Response Test try unsaved Deskripsi/Kepribadian text. */
export async function generateReply(
  agentId: number,
  turns: ChatTurn[],
  overrides?: { description?: string; personality?: string },
  segment?: Segment,
  options?: { extraContext?: string; skipShipping?: boolean },
) {
  const config = await getAiConfig();
  if (!config) throw new AiNotConfiguredError();
  const loaded = await loadAgent(agentId);
  if (!loaded) throw new Error("AI Agent tidak ditemukan.");
  const agent = { ...loaded, ...Object.fromEntries(Object.entries(overrides ?? {}).filter(([, v]) => v !== undefined)) };
  const messages = toMessages(turns);
  if (!messages.length) throw new Error("Belum ada pesan pelanggan untuk dibalas.");
  // Package prices the customer pays, for the COD breakdown in the shipping section.
  const items = agent.products.flatMap((p) =>
    p.variants.map((v) => ({ name: agent.products.length > 1 ? `${p.name} ${v.name}` : v.name, price: v.salePrice ?? v.price })));

  const omsEnabled = omsConfigured();
  const [shipping, catalog] = await Promise.all([
    options?.skipShipping
      ? Promise.resolve(null)
      : shippingContext(turns, { items, segment }),
    omsEnabled ? getOmsCatalog() : Promise.resolve(null),
  ]);
  const system = [
    buildSystemPrompt(
      agent,
      shipping,
      omsEnabled ? (catalog ? catalogPrompt(catalog) : catalogUnavailablePrompt()) : null,
      omsEnabled,
    ),
    options?.extraContext?.trim(),
  ].filter(Boolean).join("\n\n");
  return config.provider === "openai"
    ? callOpenAiCompatible(system, messages, config)
    : callClaude(system, messages, config);
}

/** One-off text generation for internal tasks (order extraction), not a customer reply. */
export async function generateText(
  system: string,
  turns: ChatTurn[],
  options: { maxTokens?: number; temperature?: number } = {},
) {
  const config = await getAiConfig();
  if (!config) throw new AiNotConfiguredError();
  const messages = toMessages(turns);
  if (!messages.length) throw new Error("Belum ada pesan untuk diproses.");
  return config.provider === "openai"
    ? callOpenAiCompatible(system, messages, config, options)
    : callClaude(system, messages, config, options);
}

type ChatCompletion = {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  error?: { message?: string };
};

async function callOpenAiCompatible(
  system: string,
  messages: Anthropic.Beta.BetaMessageParam[],
  config: AiConfig,
  options: { maxTokens?: number; temperature?: number } = {},
) {
  const base = config.baseUrl.replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        max_tokens: options.maxTokens ?? 2048,
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
        messages: [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role, content: m.content as string }))],
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new Error("Tidak dapat terhubung ke server AI. Cek base URL AI di Integrasi → AI / LLM atau koneksi internet.");
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

async function callClaude(
  system: string,
  messages: Anthropic.Beta.BetaMessageParam[],
  config: AiConfig,
  options: { maxTokens?: number; temperature?: number } = {},
) {
  const client = new Anthropic({ apiKey: config.apiKey });
  try {
    const response = await client.beta.messages.create({
      model: config.model,
      max_tokens: options.maxTokens ?? 16000,
      ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
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
