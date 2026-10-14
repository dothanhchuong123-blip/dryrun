"use client";

import React, { useState } from "react";
import { useMarketStore } from "../lib/store";

export interface GroundingCardsProps {
  className?: string;
}

/**
 * Placeholder GroundingCards slot in the Left Pane (25%).
 * Replaced by Task T11. Reads grounding events and news-check actions from lib/store.ts.
 */
export function GroundingCards({ className = "" }: GroundingCardsProps) {
  const groundings = useMarketStore((s) => s.groundings);
  const mode = useMarketStore((s) => s.mode);
  const triggerNewsCheck = useMarketStore((s) => s.triggerNewsCheck);
  const [checking, setChecking] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const handleCheckNews = async () => {
    setChecking(true);
    setStatusMsg(null);
    try {
      const res = await triggerNewsCheck();
      if (!res.accepted && res.reason) {
        setStatusMsg(res.reason);
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <div
      className={`flex h-full w-full flex-col overflow-hidden rounded border border-slate-800/90 bg-[#0b0f17] p-2.5 text-xs ${className}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2 border-b border-slate-800/80 pb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-cyan-400" />
          <span className="font-semibold uppercase tracking-wider text-slate-200">
            Tavily Grounding Cards
          </span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
            {groundings.length}
          </span>
        </div>
        <button
          type="button"
          onClick={handleCheckNews}
          disabled={checking}
          className="rounded border border-cyan-500/40 bg-cyan-950/60 px-2 py-0.5 text-[11px] font-medium text-cyan-300 transition hover:border-cyan-400 hover:bg-cyan-900/60 disabled:opacity-50"
        >
          {checking ? "Scouting…" : "Check live news"}
        </button>
      </div>

      {statusMsg && (
        <div className="mb-1.5 rounded border border-amber-500/40 bg-amber-950/40 px-2 py-1 text-[11px] text-amber-300">
          {statusMsg}
        </div>
      )}

      <div className="flex-1 space-y-2 overflow-y-auto pr-1">
        {groundings.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-[11px] text-slate-500">
            Awaiting Tavily shock grounding card… (T11 slot)
          </div>
        ) : (
          groundings.map((card) => (
            <div
              key={card.id}
              className="rounded border border-slate-800 bg-[#0f1522] p-2 transition hover:border-cyan-500/40"
            >
              <div className="mb-1 flex items-center justify-between gap-1.5">
                <span className="truncate font-semibold text-cyan-300">
                  {card.title}
                </span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                    card.applied
                      ? "bg-emerald-950/80 text-emerald-300 border border-emerald-500/30"
                      : "bg-amber-950/80 text-amber-300 border border-amber-500/30"
                  }`}
                >
                  {card.applied
                    ? "Applied"
                    : mode === "replay"
                    ? "Preview (Replay)"
                    : "Unapplied"}
                </span>
              </div>
              <p className="mb-1.5 line-clamp-2 italic text-slate-300">
                “{card.quote}”
              </p>
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span className="rounded bg-cyan-950/70 px-1.5 py-0.5 font-mono text-cyan-300">
                  {card.param} = {card.value >= 0 ? `+${card.value}` : card.value}
                </span>
                <a
                  href={card.url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-slate-400 underline decoration-slate-600 hover:text-cyan-300"
                >
                  Source ↗
                </a>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default GroundingCards;

