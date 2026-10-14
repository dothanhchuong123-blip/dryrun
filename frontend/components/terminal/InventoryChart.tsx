"use client";

import React, { useMemo } from "react";
import { FirmPair, TickEventData } from "../../lib/events";
import { formatCompactNumber } from "../../lib/format";
import { CombinedTickPoint } from "../../lib/store";

export interface InventoryChartProps {
  tickSeries: CombinedTickPoint[];
  latestU1: TickEventData | null;
  spilloverTotal: FirmPair<number>;
  omega?: number | null;
}

export function InventoryChart({
  tickSeries,
  latestU1,
  spilloverTotal,
  omega,
}: InventoryChartProps) {
  const invA = latestU1?.inventory?.[0] ?? 0;
  const invB = latestU1?.inventory?.[1] ?? 0;
  const rawInvA = latestU1?.raw_inv?.[0] ?? 0;
  const rawInvB = latestU1?.raw_inv?.[1] ?? 0;
  const ropA = latestU1?.rop?.[0] ?? 0;
  const ropB = latestU1?.rop?.[1] ?? 0;
  const unmetA = latestU1?.unmet?.[0] ?? 0;
  const unmetB = latestU1?.unmet?.[1] ?? 0;
  const spillInA = latestU1?.spill_in?.[0] ?? 0;
  const spillInB = latestU1?.spill_in?.[1] ?? 0;
  const lostTotal = latestU1?.lost ?? 0;

  const stockoutA = latestU1 !== null && (invA <= 0.5 || unmetA > 0);
  const stockoutB = latestU1 !== null && (invB <= 0.5 || unmetB > 0);

  const chartGeometry = useMemo(() => {
    const width = 360;
    const height = 88;
    const padLeft = 34;
    const padRight = 8;
    const padTop = 8;
    const padBottom = 14;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    if (tickSeries.length === 0) {
      return {
        width,
        height,
        padLeft,
        padTop,
        plotW,
        plotH,
        invAPoints: "",
        ropAPoints: "",
        invBPoints: "",
        ropBPoints: "",
        maxVal: 400,
      };
    }

    let maxVal = 100;
    for (const pt of tickSeries) {
      const u1 = pt.u1;
      maxVal = Math.max(
        maxVal,
        u1.inventory?.[0] ?? 0,
        u1.inventory?.[1] ?? 0,
        u1.rop?.[0] ?? 0,
        u1.rop?.[1] ?? 0
      );
    }
    const yMax = maxVal * 1.1;

    const minTick = tickSeries[0].tick;
    const maxTick = Math.max(minTick + 1, tickSeries[tickSeries.length - 1].tick);

    const toX = (t: number) =>
      padLeft + ((t - minTick) / Math.max(1, maxTick - minTick)) * plotW;
    const toY = (v: number) =>
      padTop + plotH - (Math.max(0, v) / Math.max(1, yMax)) * plotH;

    const invA: string[] = [];
    const ropA: string[] = [];
    const invB: string[] = [];
    const ropB: string[] = [];

    for (const pt of tickSeries) {
      const x = toX(pt.tick).toFixed(1);
      invA.push(`${x},${toY(pt.u1.inventory?.[0] ?? 0).toFixed(1)}`);
      ropA.push(`${x},${toY(pt.u1.rop?.[0] ?? 0).toFixed(1)}`);
      invB.push(`${x},${toY(pt.u1.inventory?.[1] ?? 0).toFixed(1)}`);
      ropB.push(`${x},${toY(pt.u1.rop?.[1] ?? 0).toFixed(1)}`);
    }

    return {
      width,
      height,
      padLeft,
      padTop,
      plotW,
      plotH,
      invAPoints: invA.join(" "),
      ropAPoints: ropA.join(" "),
      invBPoints: invB.join(" "),
      ropBPoints: ropB.join(" "),
      maxVal: yMax,
    };
  }, [tickSeries]);

  return (
    <section
      aria-label="Inventory vs ROP and Stockout Spillover"
      className="rounded border border-slate-800/90 bg-[#0f1522] p-2.5"
    >
      {/* Header + Spillover Counter */}
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-cyan-400" />
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-200">
            Inventory vs ROP (s,S)
          </h3>
          {typeof omega === "number" && (
            <span className="rounded border border-cyan-500/30 bg-cyan-950/50 px-1.5 py-0.5 font-mono text-[9px] text-cyan-300 tabular-nums">
              ω={omega >= 0 ? `+${omega.toFixed(2)}` : omega.toFixed(2)}
            </span>
          )}
        </div>

        {/* Stockout Spillover Counter Badge */}
        <div
          data-testid="spillover-counter"
          className="flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-950/40 px-2 py-0.5 font-mono text-[10px] text-amber-200 tabular-nums"
        >
          <span className="text-amber-400 font-semibold">Spillover:</span>
          <span>A +{formatCompactNumber(spilloverTotal[0], 1)}u</span>
          <span className="text-slate-600">|</span>
          <span>B +{formatCompactNumber(spilloverTotal[1], 1)}u</span>
        </div>
      </div>

      {/* Per-Firm Status Cards */}
      <div className="mb-2 grid grid-cols-2 gap-1.5 font-mono text-[10px] tabular-nums">
        {/* Firm A */}
        <div
          className={`rounded border px-2 py-1 ${
            stockoutA
              ? "border-rose-500/60 bg-rose-950/35"
              : "border-slate-800 bg-[#0b101b]"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-bold text-purple-300">FIRM A</span>
            <span
              className={`rounded px-1 text-[9px] font-semibold ${
                stockoutA
                  ? "bg-rose-500/30 text-rose-200"
                  : "bg-slate-800 text-slate-400"
              }`}
            >
              {stockoutA ? "STOCKOUT" : `Raw ${formatCompactNumber(rawInvA, 0)}u`}
            </span>
          </div>
          <div className="mt-0.5 flex items-baseline justify-between">
            <span className="text-slate-400">Inv / ROP:</span>
            <span className="font-bold text-slate-100">
              {formatCompactNumber(invA, 0)} / {formatCompactNumber(ropA, 0)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center justify-between text-[9px] text-slate-400">
            <span>Spill-in: +{spillInA.toFixed(1)}u</span>
            <span>Unmet: {unmetA.toFixed(1)}u</span>
          </div>
        </div>

        {/* Firm B */}
        <div
          className={`rounded border px-2 py-1 ${
            stockoutB
              ? "border-rose-500/60 bg-rose-950/35"
              : "border-slate-800 bg-[#0b101b]"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-bold text-amber-300">FIRM B</span>
            <span
              className={`rounded px-1 text-[9px] font-semibold ${
                stockoutB
                  ? "bg-rose-500/30 text-rose-200"
                  : "bg-slate-800 text-slate-400"
              }`}
            >
              {stockoutB ? "STOCKOUT" : `Raw ${formatCompactNumber(rawInvB, 0)}u`}
            </span>
          </div>
          <div className="mt-0.5 flex items-baseline justify-between">
            <span className="text-slate-400">Inv / ROP:</span>
            <span className="font-bold text-slate-100">
              {formatCompactNumber(invB, 0)} / {formatCompactNumber(ropB, 0)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center justify-between text-[9px] text-slate-400">
            <span>Spill-in: +{spillInB.toFixed(1)}u</span>
            <span>Lost mkt: {lostTotal.toFixed(1)}u</span>
          </div>
        </div>
      </div>

      {/* SVG Inventory vs ROP Chart */}
      <div className="relative h-[88px] w-full overflow-hidden rounded border border-slate-800/80 bg-[#090d15]">
        <svg
          viewBox={`0 0 ${chartGeometry.width} ${chartGeometry.height}`}
          className="h-full w-full select-none"
          preserveAspectRatio="none"
        >
          {[0, 0.5, 1].map((frac, idx) => {
            const val = chartGeometry.maxVal * frac;
            const y =
              chartGeometry.padTop +
              chartGeometry.plotH * (1 - frac);
            return (
              <g key={idx}>
                <line
                  x1={chartGeometry.padLeft}
                  y1={y}
                  x2={chartGeometry.width - 8}
                  y2={y}
                  stroke="#1e293b"
                  strokeDasharray="2 2"
                  strokeWidth="1"
                />
                <text
                  x={chartGeometry.padLeft - 4}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-slate-500 font-mono text-[8px]"
                >
                  {formatCompactNumber(val, 0)}
                </text>
              </g>
            );
          })}

          {/* Firm A ROP (dashed purple) & Inventory (solid purple) */}
          {chartGeometry.ropAPoints && (
            <polyline
              fill="none"
              stroke="#c084fc"
              strokeOpacity="0.55"
              strokeWidth="1.2"
              strokeDasharray="3 2"
              points={chartGeometry.ropAPoints}
            />
          )}
          {chartGeometry.invAPoints && (
            <polyline
              fill="none"
              stroke="#a855f7"
              strokeWidth="1.8"
              points={chartGeometry.invAPoints}
            />
          )}

          {/* Firm B ROP (dashed amber) & Inventory (solid amber) */}
          {chartGeometry.ropBPoints && (
            <polyline
              fill="none"
              stroke="#fbbf24"
              strokeOpacity="0.55"
              strokeWidth="1.2"
              strokeDasharray="3 2"
              points={chartGeometry.ropBPoints}
            />
          )}
          {chartGeometry.invBPoints && (
            <polyline
              fill="none"
              stroke="#f59e0b"
              strokeWidth="1.6"
              points={chartGeometry.invBPoints}
            />
          )}
        </svg>

        <div className="pointer-events-none absolute bottom-0.5 right-2 flex items-center gap-2 font-mono text-[8px] text-slate-400">
          <span className="text-purple-300">— Inv A / -- ROP A</span>
          <span className="text-amber-300">— Inv B / -- ROP B</span>
        </div>
      </div>
    </section>
  );
}

export default InventoryChart;
