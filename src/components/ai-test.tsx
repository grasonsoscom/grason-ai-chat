"use client";

import { useState, useTransition } from "react";
import { testAgentReply } from "@/app/(app)/ai-agent/actions";

type Turn = { role: "user" | "assistant"; text: string };

/** Floating chat to try the agent. Picks up unsaved Deskripsi/Kepribadian from the open form. */
export function AiResponseTest({ agentId }: { agentId: number }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || pending) return;
    const next = [...turns, { role: "user" as const, text }];
    setTurns(next);
    setInput("");
    setError("");
    const read = (name: string) => (document.querySelector(`[name="${name}"]`) as HTMLTextAreaElement | null)?.value;
    start(async () => {
      const res = await testAgentReply(agentId, next, { description: read("description"), personality: read("personality") });
      if (res.error) setError(res.error);
      else setTurns([...next, { role: "assistant", text: res.reply! }]);
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(!open)} className="fixed bottom-6 right-6 z-40 rounded-full bg-purple-600 px-5 py-3 text-sm font-medium text-white shadow-lg hover:bg-purple-700">
        🧪 AI Response Test
      </button>
      {open && (
        <div className="fixed bottom-20 right-6 z-40 flex h-[480px] w-[360px] max-w-[calc(100vw-3rem)] flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div>
              <p className="font-semibold">AI Response Test</p>
              <p className="text-xs text-slate-500">Memakai teks yang sedang diedit, meski belum disimpan</p>
            </div>
            <button type="button" className="text-xs text-slate-500 hover:text-slate-800" onClick={() => { setTurns([]); setError(""); }}>Reset</button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50 p-3 text-sm">
            {turns.length === 0 && <p className="text-center text-xs text-slate-400">Kirim pesan sebagai pelanggan untuk melihat balasan AI.</p>}
            {turns.map((t, i) => (
              <div key={i} className={`flex ${t.role === "assistant" ? "" : "justify-end"}`}>
                <p className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 ${t.role === "assistant" ? "bg-white shadow-sm" : "bg-green-600 text-white"}`}>{t.text}</p>
              </div>
            ))}
            {pending && <p className="text-xs text-slate-400">AI sedang mengetik...</p>}
            {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
          </div>
          <form onSubmit={send} className="flex gap-2 border-t border-slate-100 p-3">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Tulis pesan pelanggan..." className="input" />
            <button className="btn btn-primary" disabled={pending}>Kirim</button>
          </form>
        </div>
      )}
    </>
  );
}
