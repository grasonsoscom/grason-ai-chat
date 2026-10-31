"use client";

import { useState } from "react";
import { saveAi } from "@/app/(app)/integrasi/actions";
import { ActionForm, SubmitButton } from "./forms";
import { Field } from "./ui";

type Props = {
  provider: "openai" | "anthropic";
  baseUrl: string;
  model: string;
  hasKey: boolean;
  source: "db" | "env" | "none";
};

export function AiSettingsForm({ provider: initialProvider, baseUrl, model: initialModel, hasKey, source }: Props) {
  const [provider, setProvider] = useState<"openai" | "anthropic">(initialProvider);
  const [model, setModel] = useState(initialModel);
  const isOpenAi = provider === "openai";

  function changeProvider(value: string) {
    setProvider(value === "openai" ? "openai" : "anthropic");
    // A model from one provider is almost never valid on the other.
    setModel("");
  }

  return (
    <ActionForm action={saveAi}>
      <Field label="Provider">
        <select
          name="aiProvider"
          className="input"
          value={provider}
          onChange={(e) => changeProvider(e.target.value)}
        >
          <option value="openai">OpenAI-compatible (DeepSeek, Griphub, OpenRouter, dll.)</option>
          <option value="anthropic">Anthropic Claude</option>
        </select>
      </Field>
      {isOpenAi && (
        <Field label="Base URL" hint="Alamat API tanpa /chat/completions, misalnya https://griphubrouter.web.id/v1.">
          <input name="aiBaseUrl" type="url" defaultValue={baseUrl} placeholder="https://griphubrouter.web.id/v1" className="input" required />
        </Field>
      )}
      <Field label="Model" hint={isOpenAi ? "Nama model persis seperti di penyedia, misalnya deepseek-v4.1-flash." : "Kosongkan untuk memakai claude-opus-5-5."}>
        <input
          name="aiModel"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={isOpenAi ? "deepseek-v4.1-flash" : "claude-opus-5-5"}
          className="input"
          required={isOpenAi}
        />
      </Field>
      <Field
        label="API key"
        hint={
          hasKey
            ? "Key sudah tersimpan. Kosongkan untuk tetap memakai key lama."
            : source === "env"
              ? "Belum ada key tersimpan di web. Isi key untuk menyimpan pengaturan dari web."
              : "Dapatkan dari dashboard penyedia model."
        }
      >
        <input name="aiApiKey" type="password" autoComplete="off" className="input" placeholder={hasKey ? "••••••••" : ""} />
      </Field>
      <p className="mb-4 text-xs text-slate-500">
        Key disimpan terenkripsi di database dan tidak ditampilkan lagi. Pengaturan web menimpa nilai di .env.
      </p>
      <SubmitButton>Simpan</SubmitButton>
    </ActionForm>
  );
}
