// AI/LLM settings stored in Account (web UI) with env fallback.
// The API key is encrypted at rest; the UI never receives it back.
import { db } from "./db";
import { decryptSecret, encryptSecret } from "./secret-box";

export type AiProvider = "openai" | "anthropic";

/** Claude model used when no model is configured. */
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

export type AiConfig = {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  source: "db" | "env";
};

function envConfig(): AiConfig | null {
  if (process.env.AI_PROVIDER === "openai") {
    const baseUrl = process.env.OPENAI_BASE_URL?.trim() ?? "";
    const model = process.env.OPENAI_MODEL?.trim() ?? "";
    const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
    if (!baseUrl || !model || !apiKey) return null;
    return { provider: "openai", baseUrl, model, apiKey, source: "env" };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  if (!apiKey) return null;
  return {
    provider: "anthropic",
    baseUrl: "",
    model: process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL,
    apiKey,
    source: "env",
  };
}

/** DB settings win when a provider and a decryptable key are stored. */
export async function getAiConfig(): Promise<AiConfig | null> {
  const account = await db.account.findUnique({
    where: { id: 1 },
    select: { aiProvider: true, aiBaseUrl: true, aiModel: true, aiApiKeyEnc: true },
  });

  if (account?.aiProvider === "openai" || account?.aiProvider === "anthropic") {
    const provider = account.aiProvider;
    const apiKey = account.aiApiKeyEnc ? decryptSecret(account.aiApiKeyEnc)?.trim() : null;
    if (apiKey) {
      const baseUrl = account.aiBaseUrl.trim();
      const model = account.aiModel.trim() || (provider === "anthropic" ? DEFAULT_ANTHROPIC_MODEL : "");
      if (provider === "openai" && (!baseUrl || !model)) return envConfig();
      return { provider, baseUrl, model, apiKey, source: "db" };
    }
  }

  return envConfig();
}

export type AiStatus = {
  configured: boolean;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  source: "db" | "env";
  hasDbKey: boolean;
};

/** Safe for pages: no API key or ciphertext is returned. */
export async function getAiStatus(): Promise<AiStatus> {
  const account = await db.account.findUnique({
    where: { id: 1 },
    select: { aiProvider: true, aiBaseUrl: true, aiModel: true, aiApiKeyEnc: true },
  });
  const config = await getAiConfig();
  const storedProvider =
    account?.aiProvider === "openai" || account?.aiProvider === "anthropic"
      ? account.aiProvider
      : null;
  const provider: AiProvider =
    config?.provider ?? storedProvider ?? (process.env.AI_PROVIDER === "openai" ? "openai" : "anthropic");
  const envModel =
    process.env.AI_PROVIDER === "openai"
      ? (process.env.OPENAI_MODEL ?? "")
      : (process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL);

  return {
    configured: Boolean(config),
    provider,
    baseUrl: config?.baseUrl || account?.aiBaseUrl || process.env.OPENAI_BASE_URL || "",
    model: config?.model || account?.aiModel || envModel,
    source: config?.source ?? "env",
    hasDbKey: Boolean(account?.aiApiKeyEnc && decryptSecret(account.aiApiKeyEnc)),
  };
}

export async function saveAiSettings(input: {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKey?: string;
}) {
  const provider = input.provider;
  if (provider !== "openai" && provider !== "anthropic") {
    throw new Error("Provider AI tidak valid.");
  }

  const current = await db.account.findUnique({
    where: { id: 1 },
    select: { aiProvider: true, aiApiKeyEnc: true },
  });
  const newKey = input.apiKey?.trim();
  const providerChanged = Boolean(current?.aiProvider && current.aiProvider !== provider);
  const storedKey = current?.aiApiKeyEnc ? decryptSecret(current.aiApiKeyEnc) : null;
  if (!newKey && (!storedKey || providerChanged)) {
    throw new Error("API key wajib diisi untuk provider ini.");
  }
  const apiKeyEnc = newKey ? encryptSecret(newKey) : current!.aiApiKeyEnc;

  const baseUrl = provider === "openai" ? input.baseUrl.trim() : "";
  const model =
    provider === "anthropic"
      ? input.model.trim() || DEFAULT_ANTHROPIC_MODEL
      : input.model.trim();
  if (provider === "openai" && (!baseUrl || !model)) {
    throw new Error("Base URL dan model wajib diisi untuk OpenAI-compatible.");
  }

  await db.account.update({
    where: { id: 1 },
    data: { aiProvider: provider, aiBaseUrl: baseUrl, aiModel: model, aiApiKeyEnc: apiKeyEnc },
  });
}
