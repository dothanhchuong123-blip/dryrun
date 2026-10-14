"use client";

import React from "react";
import { useMarketStore } from "../lib/store";

export interface TerminalProps {
  className?: string;
}

/**
 * Placeholder Terminal component in the Right Pane (30%).
 * Replaced by Task T11 (Profit CI fan chart, Inventory vs ROP, Bullwhip gauge, 3x3 Nash matrix, Econometric stats).
 */
export function Terminal({ className = "" }: TerminalProps) {
  const latestU1 = useMarketStore((s) => s.latestU1);
  const latestU2 = useMarketStore((s) => s.latestU2);
  const nash = useMarketStore((s) => s.nash);
  const stats = useMarketStore((s) => s.stats);
  const tickSeries = useMarketStore((s) => s.tickSeries);
  const spilloverTotal = useMarketStore((s) => s.spilloverTotal);

  const aiCumA = latestU1?.cum_profit?.[0] ?? 0;
  const baseCumA = latestU2?.cum_profit?.[0] ?? 0;
  const alpha = aiCumA - baseCumA;

  return (
    <div
      className={`flex h-full w-full flex-col justify-between gap-3 overflow-y-auto rounded border border-slate-800/90 bg-[#0b0f17] p-3.5 text-xs ${className}`}
    >
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
          <span className="font-bold uppercase tracking-wider text-slate-200">
            Econometric Terminal (T11 Slot)
          </span>
        </div>
        <span className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] font-mono text-slate-300">
          Series: {tickSeries.length}/120 ticks
        </span>
      </div>

      {/* Profit AI vs Baseline summary */}
      <div className="rounded border border-slate-800 bg-[#0f1522] p-2.5">
        <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
          <span>Cumulative Profit (AI U1 vs Baseline U2)</span>
          <span className="font-mono text-emerald-400">
            Δπ = {alpha >= 0 ? "+" : ""}${alpha.toFixed(1)}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 font-mono">
          <div className="rounded bg-purple-950/30 p-2 border border-purple-500/30">
            <div className="text-[10px] text-purple-300">U1 AI CEO (Firm A)</div>
            <div className="text-sm font-bold text-slate-100">
              ${aiCumA.toFixed(0)}
            </div>
          </div>
          <div className="rounded bg-slate-900/80 p-2 border border-slate-700/60">
            <div className="text-[10px] text-slate-400">
              U2 Cost-Plus Baseline
            </div>
            <div className="text-sm font-bold text-slate-300">
              ${baseCumA.toFixed(0)}
            </div>
          </div>
        </div>
      </div>

      {/* Inventory vs ROP & Bullwhip */}
      <div className="rounded border border-slate-800 bg-[#0f1522] p-2.5">
        <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-400">
          <span>Supply Chain (s,S) & Bullwhip Ratio</span>
          <span className="font-mono text-cyan-300">
            Spillover A/B: {spilloverTotal[0].toFixed(0)}u /{" "}
            {spilloverTotal[1].toFixed(0)}u
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
          <div>
            <span className="text-slate-400">Inv / ROP (A): </span>
            <span className="text-slate-200">
              {(latestU1?.inventory?.[0] ?? 0).toFixed(0)} /{" "}
              {latestU1?.rop?.[0] ?? 0}
            </span>
          </div>
          <div>
            <span className="text-slate-400">Bullwhip (A/B): </span>
            <span className="text-amber-300">
              {latestU1?.bullwhip
                ? `${latestU1.bullwhip[0] ?? "—"}x / ${
                    latestU1.bullwhip[1] ?? "—"
                  }x`
                : "warming (<8t)"}
            </span>
          </div>
        </div>
      </div>

      {/* 3x3 Nash Matrix Preview */}
      <div className="rounded border border-slate-800 bg-[#0f1522] p-2.5">
        <div className="mb-1.5 flex items-center justify-between text-[11px]">
          <span className="text-slate-400">3×3 Bertrand Nash Matrix</span>
          <span className="rounded bg-purple-950/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-purple-300 border border-purple-500/30">
            {nash?.label ?? "nash"}
          </span>
        </div>
        {nash ? (
          <div className="grid grid-cols-3 gap-1 font-mono text-[10px]">
            {nash.payoff_A.map((row, rIdx) =>
              row.map((valA, cIdx) => {
                const valB = nash.payoff_B[rIdx]?.[cIdx] ?? 0;
                const isChosen =
                  nash.chosen[0] === rIdx && nash.chosen[1] === cIdx;
                const isNe = nash.pure_ne.some(
                  ([neR, neC]) => neR === rIdx && neC === cIdx
                );
                return (
                  <div
                    key={`${rIdx}-${cIdx}`}
                    className={`rounded border px-1.5 py-1 text-center ${
                      isChosen
                        ? "border-amber-400 bg-amber-950/50 text-amber-200"
                        : isNe
                        ? "border-cyan-500/50 bg-cyan-950/30 text-cyan-200"
                        : "border-slate-800 bg-slate-900/50 text-slate-400"
                    }`}
                  >
                    {valA} / {valB}
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div className="py-3 text-center text-[11px] text-slate-500">
            Awaiting epoch Nash equilibrium evaluation…
          </div>
        )}
      </div>

      {/* Econometric Stats Table */}
      <div className="rounded border border-slate-800 bg-[#0f1522] p-2.5 font-mono text-[11px]">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="font-sans text-slate-400">
            Paired t-test & Brand-Switch χ²
          </span>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
              stats?.source === "cloud"
                ? "bg-emerald-950/80 text-emerald-300 border border-emerald-500/40"
                : "bg-cyan-950/80 text-cyan-300 border border-cyan-500/40"
            }`}
          >
            {stats?.source === "cloud"
              ? `Cloud-Verified (n=${stats.n.toLocaleString()})`
              : `Live (n=${stats?.n ?? 100})`}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-y-1 text-slate-300">
          <div>
            Mean Δπ:{" "}
            <span className="text-emerald-400">
              ${(stats?.delta_mean ?? 0).toFixed(1)}
            </span>
          </div>
          <div>
            95% CI: [{(stats?.ci95?.[0] ?? 0).toFixed(0)},{" "}
            {(stats?.ci95?.[1] ?? 0).toFixed(0)}]
          </div>
          <div>Cohen&apos;s d: {(stats?.cohens_d ?? 0).toFixed(2)}</div>
          <div>p-value: {stats?.p_value ?? "—"}</div>
          <div>χ²: {stats?.chi2 ?? "—"}</div>
          <div>χ² p: {stats?.chi2_p ?? "—"}</div>
        </div>
      </div>
    </div>
  );
}

export default Terminal;

