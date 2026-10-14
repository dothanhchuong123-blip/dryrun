"use client";

import React from "react";
import { Matrix3x3, NashEventData } from "../../lib/events";
import {
  formatCompactNumber,
  formatNashLabel,
  formatPercent,
} from "../../lib/format";

export interface NashMatrixProps {
  nash: NashEventData | null;
}

const DEFAULT_ACTIONS = ["cut", "hold", "raise"] as const;
const EMPTY_MATRIX: Matrix3x3 = [
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
];

function formatActionHeader(action: string): string {
  switch (action.toLowerCase()) {
    case "cut":
      return "Cut −10%";
    case "hold":
      return "Hold 0%";
    case "raise":
      return "Raise +10%";
    default:
      return action;
  }
}

export function NashMatrix({ nash }: NashMatrixProps) {
  const actions =
    nash?.actions && nash.actions.length === 3
      ? nash.actions
      : DEFAULT_ACTIONS;
  const payoffA = nash?.payoff_A ?? EMPTY_MATRIX;
  const payoffB = nash?.payoff_B ?? EMPTY_MATRIX;
  const pureNe = nash?.pure_ne ?? [];
  const chosen = nash?.chosen ?? null;
  const labelInfo = formatNashLabel(nash?.label ?? "nash");

  const isPureNe = (r: number, c: number): boolean =>
    pureNe.some(([neR, neC]) => neR === r && neC === c);

  const isChosen = (r: number, c: number): boolean =>
    chosen !== null && chosen[0] === r && chosen[1] === c;

  return (
    <section
      aria-label="3x3 Bertrand Nash Payoff Matrix"
      className="rounded border border-slate-800/90 bg-[#0f1522] p-2.5"
    >
      {/* Header + Regime Chip */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-purple-400" />
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-200">
            3×3 Nash Payoff Matrix (π_A, π_B)
          </h3>
        </div>
        <span
          data-testid="nash-regime-chip"
          title={labelInfo.description}
          className={`rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide ${labelInfo.chipClass}`}
        >
          {labelInfo.text}
        </span>
      </div>

      {/* 3x3 Matrix Table */}
      <div className="grid grid-cols-4 gap-1 font-mono text-[10px] tabular-nums">
        {/* Top-left corner axis key */}
        <div className="flex flex-col justify-between rounded border border-slate-800/80 bg-[#090d15] px-1.5 py-1 text-[9px] text-slate-400">
          <span className="text-right text-amber-300">B →</span>
          <span className="text-purple-300">↓ A</span>
        </div>

        {/* Column headers (Firm B actions) */}
        {actions.map((act, cIdx) => (
          <div
            key={`col-${cIdx}`}
            className="flex items-center justify-center rounded border border-slate-800/80 bg-[#090d15] px-1 py-1 text-center text-[9px] font-semibold text-amber-300"
          >
            {formatActionHeader(String(act))}
          </div>
        ))}

        {/* Rows (Firm A actions + 3 cells per row) */}
        {actions.map((rowAct, rIdx) => (
          <React.Fragment key={`row-${rIdx}`}>
            <div className="flex items-center rounded border border-slate-800/80 bg-[#090d15] px-1.5 py-1.5 text-[9px] font-semibold text-purple-300">
              {formatActionHeader(String(rowAct))}
            </div>

            {[0, 1, 2].map((cIdx) => {
              const piA = payoffA[rIdx]?.[cIdx] ?? 0;
              const piB = payoffB[rIdx]?.[cIdx] ?? 0;
              const ne = nash !== null && isPureNe(rIdx, cIdx);
              const picked = nash !== null && isChosen(rIdx, cIdx);

              // Pure NE gets a distinct outline; chosen cell is filled
              const cellStyle = picked
                ? ne
                  ? "bg-purple-500/35 border-cyan-300 ring-2 ring-cyan-400/90 text-white"
                  : "bg-purple-500/30 border-purple-400/80 text-white"
                : ne
                ? "bg-[#0b1220] border-cyan-400 ring-2 ring-cyan-400/80 text-cyan-200"
                : "bg-[#0b101b] border-slate-800/90 text-slate-300";

              return (
                <div
                  key={`cell-${rIdx}-${cIdx}`}
                  data-testid={`nash-cell-${rIdx}-${cIdx}`}
                  data-pure-ne={ne ? "true" : "false"}
                  data-chosen={picked ? "true" : "false"}
                  className={`relative flex min-h-[38px] flex-col items-center justify-center rounded border px-1 py-1 text-center transition-colors ${cellStyle}`}
                >
                  <div className="text-[10px] font-semibold leading-tight">
                    {nash
                      ? `(${formatCompactNumber(piA, 1)}, ${formatCompactNumber(
                          piB,
                          1
                        )})`
                      : "(—, —)"}
                  </div>

                  {(ne || picked) && (
                    <div className="mt-0.5 flex items-center gap-1 text-[8px] font-bold uppercase leading-none">
                      {ne && <span className="text-cyan-300">NE</span>}
                      {picked && <span className="text-amber-300">●</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>

      {/* Legend & Mixed NE Support Footer */}
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[9px] text-slate-400">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm border border-cyan-400 ring-1 ring-cyan-400" />
            Pure NE Outline
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-purple-500/60" />
            Chosen Cell Fill
          </span>
        </div>

        {nash?.mixed_ne && (
          <span className="font-mono text-[9px] text-slate-400 tabular-nums">
            Mixed p_A=[
            {nash.mixed_ne.p_A
              .map((p) => formatPercent(p, { decimals: 0, isFraction: true }))
              .join(",")}
            ]
          </span>
        )}
      </div>
    </section>
  );
}

export default NashMatrix;
