"use client";

import { useOptimistic, useTransition } from "react";
import { setAiMode } from "./actions";

/** On = the AI agent replies; off = staff reply manually. */
export function AiToggle({ conversationId, on, changed }: { conversationId: number; on: boolean; changed: string }) {
  const [pending, start] = useTransition();
  const [optimisticOn, setOptimisticOn] = useOptimistic(on);
  const toggle = () =>
    start(async () => {
      setOptimisticOn(!optimisticOn);
      const res = await setAiMode(conversationId, !optimisticOn);
      if (res?.error) alert(res.error);
    });
  return (
    <div className="flex flex-col items-end">
      <button type="button" role="switch" aria-checked={optimisticOn} onClick={toggle} disabled={pending}
        title={optimisticOn ? "Agen AI membalas otomatis. Klik untuk membalas manual." : "Staf membalas manual. Klik untuk menyalakan Agen AI."}
        className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full py-1 pl-3 pr-1 text-xs font-semibold transition-colors disabled:opacity-70 ${optimisticOn ? "bg-green-600 text-white" : "bg-slate-200 text-slate-600"}`}>
        Agen AI
        <span className={`relative h-5 w-9 shrink-0 rounded-full ${optimisticOn ? "bg-white/30" : "bg-slate-300"}`}>
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${optimisticOn ? "left-[18px]" : "left-0.5"}`} />
        </span>
      </button>
      <span className="mt-0.5 whitespace-nowrap text-[11px] text-slate-400">{changed}</span>
    </div>
  );
}
