"use client";

import React from "react";
import { choicesRef, useMarketStore } from "../lib/store";

export interface ArenaProps {
  className?: string;
}

/**
 * Placeholder Arena component in the Centre Pane (45%).
 * Replaced by Task T12 (HTML5 Canvas 200-500 sprites reading choicesRef).
 */
export function Arena({ className = "" }: ArenaProps) {
  const latestU1 = useMarketStore((s) => s.latestU1);
  const currentTick = useMarketStore((s) => s.currentTick);
  const nConsumers = useMarketStore((s) => s.nConsumers);
  const archetypes = useMarketStore((s) => s.archetypes);

  const shares = latestU1?.shares ?? [0.16, 0.46, 0.38];
  const inv = latestU1?.inventory ?? [0, 0];
  const unmet = latestU1?.unmet ?? [0, 0];

  return (
    <div
      className={`flex h-full w-full flex-col justify-between overflow-hidden rounded border border-slate-800/90 bg-[#090d14] p-4 ${className}`}
    >
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-purple-400" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Market & Supply-Chain Arena (T12 Canvas Slot)
            </h2>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Port → Firm A / Firm B HQ → Consumer District · TypedArray{" "}
            <code className="text-cyan-300">
              choicesRef ({choicesRef.nConsumers || nConsumers} sprites)
            </code>
          </p>
        </div>
        <div className="text-right font-mono text-xs text-slate-300">
          <div>TICK #{currentTick}</div>
          <div className="text-[11px] text-cyan-400">
            L = {latestU1?.lead_time ?? 4}t · c_raw = $
            {(latestU1?.c_raw ?? 52).toFixed(2)}
          </div>
        </div>
      </div>

      <div className="my-auto grid grid-cols-3 gap-3 py-4">
        <div className="rounded border border-purple-500/40 bg-purple-950/20 p-3">
          <div className="text-[11px] font-semibold uppercase text-purple-300">
            Firm A (Ultra CEO)
          </div>
          <div className="mt-1 text-lg font-bold text-slate-100">
            ${(latestU1?.price?.[0] ?? 94).toFixed(2)}
          </div>
          <div className="mt-1 space-y-0.5 text-[11px] text-slate-400">
            <div>Share: {(shares[1] * 100).toFixed(1)}%</div>
            <div className={unmet[0] > 0 ? "text-rose-400 font-semibold" : ""}>
              Stock: {inv[0].toFixed(0)}u (Unmet: {unmet[0].toFixed(1)})
            </div>
            <div>Sales: {(latestU1?.sales?.[0] ?? 0).toFixed(1)}u</div>
          </div>
        </div>

        <div className="rounded border border-slate-700/70 bg-slate-900/40 p-3 text-center">
          <div className="text-[11px] font-semibold uppercase text-slate-400">
            Outside Good / Bank
          </div>
          <div className="mt-1 text-lg font-bold text-slate-200">
            {(shares[0] * 100).toFixed(1)}%
          </div>
          <div className="mt-1 space-y-0.5 text-[11px] text-slate-400">
            <div>Lost Demand: {(latestU1?.lost ?? 0).toFixed(1)}u</div>
            <div>Archetypes Active: {archetypes.length || 12}</div>
            <div>Buffer Tick: #{choicesRef.tick}</div>
          </div>
        </div>

        <div className="rounded border border-amber-500/40 bg-amber-950/20 p-3">
          <div className="text-[11px] font-semibold uppercase text-amber-300">
            Firm B (Ultra CEO)
          </div>
          <div className="mt-1 text-lg font-bold text-slate-100">
            ${(latestU1?.price?.[1] ?? 91.5).toFixed(2)}
          </div>
          <div className="mt-1 space-y-0.5 text-[11px] text-slate-400">
            <div>Share: {(shares[2] * 100).toFixed(1)}%</div>
            <div className={unmet[1] > 0 ? "text-rose-400 font-semibold" : ""}>
              Stock: {inv[1].toFixed(0)}u (Unmet: {unmet[1].toFixed(1)})
            </div>
            <div>Sales: {(latestU1?.sales?.[1] ?? 0).toFixed(1)}u</div>
          </div>
        </div>
      </div>

      <div className="rounded border border-slate-800/80 bg-[#0d131f] px-3 py-2 text-[11px] text-slate-400">
        <span className="font-semibold text-emerald-400">Crowd Pulse:</span>{" "}
        {archetypes[0]?.bubble ??
          "12 consumer archetypes evaluating MNL utilities & stockout spillover…"}
      </div>
    </div>
  );
}

export default Arena;

