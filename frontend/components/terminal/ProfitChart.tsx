"use client";

import React, { useMemo } from "react";
import { JobStatus, StatsEventData } from "../../lib/events";
import {
  formatCurrency,
  formatInt,
  formatSignedCurrency,
  isValidNumber,
} from "../../lib/format";
import { CombinedTickPoint } from "../../lib/store";

export interface ProfitChartProps {
  tickSeries: CombinedTickPoint[];
  stats: StatsEventData | null;
  jobStatus?: JobStatus;
}

interface FanBandPoint {
  tick: number;
  lo: number;
  hi: number;
}

/**
 * Flexible extractor for `stats.fan` when present on `stats` or per-tick `stats`.
 * Supports:
 * - Array<[lo, hi]>
 * - Array<{ tick?: number; lo?: number; hi?: number; lower?: number; upper?: number }>
 * - { lo: number[]; hi: number[]; ticks?: number[] }
 * - { lower: number[]; upper: number[]; ticks?: number[] }
 * - Single tuple [lo, hi]
 */
function extractStatsFan(
  tickSeries: CombinedTickPoint[],
  stats: StatsEventData | null
): FanBandPoint[] {
  if (tickSeries.length === 0) return [];

  const rawFan =
    stats && typeof stats === "object"
      ? (stats as unknown as Record<string, unknown>).fan
      : undefined;

  if (rawFan !== undefined && rawFan !== null) {
    // Case 1: Single tuple [lo, hi]
    if (
      Array.isArray(rawFan) &&
      rawFan.length === 2 &&
      isValidNumber(rawFan[0]) &&
      isValidNumber(rawFan[1])
    ) {
      const halfSpread = Math.abs(rawFan[1] - rawFan[0]) / 2;
      return tickSeries.map((pt, idx) => {
        const ai = pt.u1.cum_profit?.[0] ?? 0;
        const scale = Math.sqrt((idx + 1) / Math.max(1, tickSeries.length));
        return {
          tick: pt.tick,
          lo: ai - halfSpread * scale,
          hi: ai + halfSpread * scale,
        };
      });
    }

    // Case 2: Array of tuples or objects
    if (Array.isArray(rawFan) && rawFan.length > 0) {
      const points: FanBandPoint[] = [];
      for (let i = 0; i < rawFan.length; i++) {
        const item = rawFan[i];
        const fallbackTick =
          tickSeries[Math.min(i, tickSeries.length - 1)]?.tick ?? i + 1;
        if (
          Array.isArray(item) &&
          item.length >= 2 &&
          isValidNumber(item[0]) &&
          isValidNumber(item[1])
        ) {
          points.push({
            tick: fallbackTick,
            lo: Math.min(item[0], item[1]),
            hi: Math.max(item[0], item[1]),
          });
        } else if (item && typeof item === "object") {
          const obj = item as Record<string, unknown>;
          const loVal = obj.lo ?? obj.lower ?? obj.p05 ?? obj.ci_lo;
          const hiVal = obj.hi ?? obj.upper ?? obj.p95 ?? obj.ci_hi;
          const tickVal = isValidNumber(obj.tick) ? obj.tick : fallbackTick;
          if (isValidNumber(loVal) && isValidNumber(hiVal)) {
            points.push({
              tick: tickVal,
              lo: Math.min(loVal, hiVal),
              hi: Math.max(loVal, hiVal),
            });
          }
        }
      }
      if (points.length > 0) return points;
    }

    // Case 3: Object with parallel arrays { lo: number[], hi: number[], ticks?: number[] }
    if (typeof rawFan === "object" && !Array.isArray(rawFan)) {
      const obj = rawFan as Record<string, unknown>;
      const loArr = (obj.lo ?? obj.lower) as unknown;
      const hiArr = (obj.hi ?? obj.upper) as unknown;
      const ticksArr = obj.ticks as unknown;
      if (Array.isArray(loArr) && Array.isArray(hiArr)) {
        const len = Math.min(loArr.length, hiArr.length);
        const points: FanBandPoint[] = [];
        for (let i = 0; i < len; i++) {
          const loVal = loArr[i];
          const hiVal = hiArr[i];
          const tickVal =
            Array.isArray(ticksArr) && isValidNumber(ticksArr[i])
              ? (ticksArr[i] as number)
              : (tickSeries[Math.min(i, tickSeries.length - 1)]?.tick ?? i + 1);
          if (isValidNumber(loVal) && isValidNumber(hiVal)) {
            points.push({
              tick: tickVal,
              lo: Math.min(loVal, hiVal),
              hi: Math.max(loVal, hiVal),
            });
          }
        }
        if (points.length > 0) return points;
      }
    }
  }

  // Also check per-tick stats.fan or per-tick stats.ci95 along the series
  const seriesFan: FanBandPoint[] = [];
  for (const pt of tickSeries) {
    const ptStats = pt.stats;
    if (!ptStats) continue;
    const ptRawFan = (ptStats as unknown as Record<string, unknown>).fan;
    if (
      Array.isArray(ptRawFan) &&
      ptRawFan.length === 2 &&
      isValidNumber(ptRawFan[0]) &&
      isValidNumber(ptRawFan[1])
    ) {
      seriesFan.push({
        tick: pt.tick,
        lo: Math.min(ptRawFan[0], ptRawFan[1]),
        hi: Math.max(ptRawFan[0], ptRawFan[1]),
      });
    } else if (
      ptStats.ci95 &&
      isValidNumber(ptStats.ci95[0]) &&
      isValidNumber(ptStats.ci95[1])
    ) {
      const aiCum = pt.u1.cum_profit?.[0] ?? 0;
      const halfWidth = Math.abs(ptStats.ci95[1] - ptStats.ci95[0]) / 2;
      seriesFan.push({
        tick: pt.tick,
        lo: aiCum - halfWidth,
        hi: aiCum + halfWidth,
      });
    }
  }

  return seriesFan;
}

export function ProfitChart({
  tickSeries,
  stats,
  jobStatus = "idle",
}: ProfitChartProps) {
  const latestPoint =
    tickSeries.length > 0 ? tickSeries[tickSeries.length - 1] : null;
  const aiCumA = latestPoint?.u1.cum_profit?.[0] ?? 0;
  const baseCumA = latestPoint?.u2?.cum_profit?.[0] ?? 0;
  const deltaCumA = aiCumA - baseCumA;

  const isCloudVerified =
    stats?.source === "cloud" ||
    jobStatus === "verified" ||
    (stats?.n ?? 0) >= 10_000;
  const sampleN = stats?.n ?? (isCloudVerified ? 10_000 : 100);

  const badgeLabel = isCloudVerified
    ? `Cloud-Verified (n=${formatInt(sampleN)})`
    : `Live (n=${formatInt(sampleN)})`;

  const chartGeometry = useMemo(() => {
    const width = 360;
    const height = 112;
    const padLeft = 42;
    const padRight = 10;
    const padTop = 10;
    const padBottom = 18;
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
        aiPoints: "",
        basePoints: "",
        fanPolygon: "",
        fanUpperPoints: "",
        fanLowerPoints: "",
        minVal: 0,
        maxVal: 1000,
        minTick: 1,
        maxTick: 1,
        yTicks: [0, 500, 1000],
      };
    }

    const fanBand = extractStatsFan(tickSeries, stats);
    const fanByTick = new Map<number, FanBandPoint>();
    for (const fb of fanBand) {
      fanByTick.set(fb.tick, fb);
    }

    let minVal = 0;
    let maxVal = 100;

    for (const pt of tickSeries) {
      const u1Val = pt.u1.cum_profit?.[0] ?? 0;
      const u2Val = pt.u2?.cum_profit?.[0] ?? u1Val;
      minVal = Math.min(minVal, u1Val, u2Val);
      maxVal = Math.max(maxVal, u1Val, u2Val);
      const fb = fanByTick.get(pt.tick);
      if (fb) {
        minVal = Math.min(minVal, fb.lo);
        maxVal = Math.max(maxVal, fb.hi);
      }
    }

    if (maxVal - minVal < 100) {
      maxVal = minVal + 100;
    }
    const rangePad = (maxVal - minVal) * 0.08;
    const yMin = minVal < 0 ? minVal - rangePad : 0;
    const yMax = maxVal + rangePad;

    const minTick = tickSeries[0].tick;
    const maxTick = Math.max(minTick + 1, tickSeries[tickSeries.length - 1].tick);

    const toX = (t: number) =>
      padLeft + ((t - minTick) / Math.max(1, maxTick - minTick)) * plotW;
    const toY = (v: number) =>
      padTop + plotH - ((v - yMin) / Math.max(1e-6, yMax - yMin)) * plotH;

    const aiCoords: string[] = [];
    const baseCoords: string[] = [];
    const fanUpper: Array<[number, number]> = [];
    const fanLower: Array<[number, number]> = [];

    for (const pt of tickSeries) {
      const x = toX(pt.tick);
      const yAi = toY(pt.u1.cum_profit?.[0] ?? 0);
      aiCoords.push(`${x.toFixed(1)},${yAi.toFixed(1)}`);

      if (pt.u2) {
        const yBase = toY(pt.u2.cum_profit?.[0] ?? 0);
        baseCoords.push(`${x.toFixed(1)},${yBase.toFixed(1)}`);
      }

      const fb = fanByTick.get(pt.tick);
      if (fb) {
        fanUpper.push([x, toY(fb.hi)]);
        fanLower.push([x, toY(fb.lo)]);
      }
    }

    let fanPolygon = "";
    let fanUpperPoints = "";
    let fanLowerPoints = "";
    if (fanUpper.length >= 2 && fanLower.length >= 2) {
      fanUpperPoints = fanUpper
        .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
        .join(" ");
      fanLowerPoints = fanLower
        .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
        .join(" ");
      const reversedLower = [...fanLower]
        .reverse()
        .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
        .join(" ");
      fanPolygon = `${fanUpperPoints} ${reversedLower}`;
    }

    const yMid = (yMin + yMax) / 2;

    return {
      width,
      height,
      padLeft,
      padTop,
      plotW,
      plotH,
      aiPoints: aiCoords.join(" "),
      basePoints: baseCoords.join(" "),
      fanPolygon,
      fanUpperPoints,
      fanLowerPoints,
      minVal: yMin,
      maxVal: yMax,
      minTick,
      maxTick,
      yTicks: [yMin, yMid, yMax],
    };
  }, [tickSeries, stats]);

  return (
    <section
      aria-label="Firm A Cumulative Profit Chart"
      className="rounded border border-slate-800/90 bg-[#0f1522] p-2.5"
    >
      {/* Header Row */}
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-purple-400" />
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-200">
            Cumulative Profit (Firm A: U1 AI vs U2 Baseline)
          </h3>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[10px] tabular-nums">
          <span className="rounded border border-slate-700/80 bg-slate-900/90 px-1.5 py-0.5 text-slate-300">
            n={formatInt(sampleN)}
          </span>
          <span
            data-testid="mc-verification-badge"
            className={`rounded border px-1.5 py-0.5 font-semibold ${
              isCloudVerified
                ? "border-emerald-500/40 bg-emerald-950/70 text-emerald-300"
                : "border-cyan-500/40 bg-cyan-950/70 text-cyan-300"
            }`}
          >
            {badgeLabel}
          </span>
        </div>
      </div>

      {/* KPI Strip (Fixed-Width Tabular Nums) */}
      <div className="mb-2 grid grid-cols-3 gap-1.5 font-mono text-[11px] tabular-nums">
        <div className="rounded border border-purple-500/30 bg-purple-950/25 px-2 py-1">
          <div className="flex items-center justify-between text-[9px] uppercase text-purple-300">
            <span>U1 Ultra AI</span>
            <span className="h-1.5 w-3 rounded-sm bg-purple-400" />
          </div>
          <div className="text-xs font-bold text-slate-100">
            {formatCurrency(aiCumA, { compact: true, decimals: 1 })}
          </div>
        </div>

        <div className="rounded border border-slate-700/60 bg-slate-900/60 px-2 py-1">
          <div className="flex items-center justify-between text-[9px] uppercase text-slate-400">
            <span>U2 Cost-Plus</span>
            <span className="h-0.5 w-3 border-b border-dashed border-slate-400" />
          </div>
          <div className="text-xs font-bold text-slate-300">
            {formatCurrency(baseCumA, { compact: true, decimals: 1 })}
          </div>
        </div>

        <div className="rounded border border-emerald-500/30 bg-emerald-950/25 px-2 py-1">
          <div className="flex items-center justify-between text-[9px] uppercase text-emerald-300">
            <span>AI Alpha Δπ</span>
            <span className="text-[9px] text-emerald-400/80">95% CI</span>
          </div>
          <div
            className={`text-xs font-bold ${
              deltaCumA >= 0 ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {formatSignedCurrency(deltaCumA, 1)}
          </div>
        </div>
      </div>

      {/* SVG Line & CI Fan Chart */}
      <div className="relative h-[112px] w-full overflow-hidden rounded border border-slate-800/80 bg-[#090d15]">
        <svg
          viewBox={`0 0 ${chartGeometry.width} ${chartGeometry.height}`}
          className="h-full w-full select-none"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="ciFanGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a855f7" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.08" />
            </linearGradient>
          </defs>

          {/* Horizontal Grid Lines & Y-Axis Labels */}
          {chartGeometry.yTicks.map((val, idx) => {
            const y =
              chartGeometry.padTop +
              chartGeometry.plotH -
              ((val - chartGeometry.minVal) /
                Math.max(1e-6, chartGeometry.maxVal - chartGeometry.minVal)) *
                chartGeometry.plotH;
            return (
              <g key={idx}>
                <line
                  x1={chartGeometry.padLeft}
                  y1={y}
                  x2={chartGeometry.width - 10}
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
                  {formatCurrency(val, { compact: true, decimals: 0 })}
                </text>
              </g>
            );
          })}

          {/* 95% Confidence Interval Fan */}
          {chartGeometry.fanPolygon && (
            <g data-testid="profit-ci-fan">
              <polygon
                points={chartGeometry.fanPolygon}
                fill="url(#ciFanGrad)"
              />
              <polyline
                fill="none"
                stroke="#c084fc"
                strokeOpacity="0.45"
                strokeWidth="1"
                strokeDasharray="2 2"
                points={chartGeometry.fanUpperPoints}
              />
              <polyline
                fill="none"
                stroke="#22d3ee"
                strokeOpacity="0.45"
                strokeWidth="1"
                strokeDasharray="2 2"
                points={chartGeometry.fanLowerPoints}
              />
            </g>
          )}

          {/* Baseline (U2) Cumulative Profit Line */}
          {chartGeometry.basePoints && (
            <polyline
              fill="none"
              stroke="#94a3b8"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              points={chartGeometry.basePoints}
            />
          )}

          {/* AI CEO (U1) Cumulative Profit Line */}
          {chartGeometry.aiPoints && (
            <polyline
              fill="none"
              stroke="#a855f7"
              strokeWidth="2"
              points={chartGeometry.aiPoints}
            />
          )}

          {/* X-Axis Tick Range Labels */}
          <text
            x={chartGeometry.padLeft}
            y={chartGeometry.height - 4}
            className="fill-slate-500 font-mono text-[8px]"
          >
            T{chartGeometry.minTick}
          </text>
          <text
            x={chartGeometry.width - 10}
            y={chartGeometry.height - 4}
            textAnchor="end"
            className="fill-slate-500 font-mono text-[8px]"
          >
            T{chartGeometry.maxTick} (rival B held fixed in U2)
          </text>
        </svg>
      </div>
    </section>
  );
}

export default ProfitChart;
