"use client";

import React, { useMemo } from "react";
import { TickEventData } from "../../lib/events";
import { formatPercent, formatUSD } from "../../lib/format";
import { CombinedTickPoint } from "../../lib/store";

export interface PriceCostChartProps {
  tickSeries: CombinedTickPoint[];
  latestU1: TickEventData | null;
}

interface FirmSparklineProps {
  firmIdx: 0 | 1;
  firmName: string;
  accentColor: string;
  accentTextClass: string;
  tickSeries: CombinedTickPoint[];
  latestU1: TickEventData | null;
}

function FirmPriceCostSparkline({
  firmIdx,
  firmName,
  accentColor,
  accentTextClass,
  tickSeries,
  latestU1,
}: FirmPriceCostSparklineProps) {
  const price = latestU1?.price?.[firmIdx] ?? 0;
  const mc = latestU1?.mc?.[firmIdx] ?? 0;
  const atc = latestU1?.atc?.[firmIdx] ?? 0;
  const marginPct = price > 0 ? (price - atc) / price : 0;

  const geometry = useMemo(() => {
    const width = 168;
    const height = 56;
    const padX = 4;
    const padY = 5;
    const plotW = width - padX * 2;
    const plotH = height - padY * 2;

    if (tickSeries.length === 0) {
      return {
        width,
        height,
        pPoints: "",
        atcPoints: "",
        mcPoints: "",
      };
    }

    let minVal = Infinity;
    let maxVal = -Infinity;
    for (const pt of tickSeries) {
      const p = pt.u1.price?.[firmIdx] ?? 0;
      const a = pt.u1.atc?.[firmIdx] ?? 0;
      const m = pt.u1.mc?.[firmIdx] ?? 0;
      minVal = Math.min(minVal, p, a, m);
      maxVal = Math.max(maxVal, p, a, m);
    }
    if (!Number.isFinite(minVal) || !Number.isFinite(maxVal)) {
      minVal = 40;
      maxVal = 120;
    }
    const span = Math.max(5, maxVal - minVal);
    const yMin = minVal - span * 0.1;
    const yMax = maxVal + span * 0.1;

    const minTick = tickSeries[0].tick;
    const maxTick = Math.max(minTick + 1, tickSeries[tickSeries.length - 1].tick);

    const toX = (t: number) =>
      padX + ((t - minTick) / Math.max(1, maxTick - minTick)) * plotW;
    const toY = (v: number) =>
      padY + plotH - ((v - yMin) / Math.max(1e-6, yMax - yMin)) * plotH;

    const pArr: string[] = [];
    const atcArr: string[] = [];
    const mcArr: string[] = [];

    for (const pt of tickSeries) {
      const x = toX(pt.tick).toFixed(1);
      pArr.push(`${x},${toY(pt.u1.price?.[firmIdx] ?? 0).toFixed(1)}`);
      atcArr.push(`${x},${toY(pt.u1.atc?.[firmIdx] ?? 0).toFixed(1)}`);
      mcArr.push(`${x},${toY(pt.u1.mc?.[firmIdx] ?? 0).toFixed(1)}`);
    }

    return {
      width,
      height,
      pPoints: pArr.join(" "),
      atcPoints: atcArr.join(" "),
      mcPoints: mcArr.join(" "),
    };
  }, [tickSeries, firmIdx]);

  return (
    <div className="rounded border border-slate-800/90 bg-[#0b101b] p-2 font-mono text-[10px] tabular-nums">
      <div className="mb-1 flex items-center justify-between">
        <span className={`font-bold ${accentTextClass}`}>{firmName}</span>
        <span
          className={`rounded px-1 py-0.5 text-[9px] font-semibold ${
            marginPct >= 0
              ? "bg-emerald-950/60 text-emerald-300"
              : "bg-rose-950/60 text-rose-300"
          }`}
        >
          Margin{" "}
          {latestU1
            ? formatPercent(marginPct, {
                decimals: 1,
                signed: true,
                isFraction: true,
              })
            : "—"}
        </span>
      </div>

      <div className="mb-1 grid grid-cols-3 gap-1 text-[9px]">
        <div>
          <span className="text-slate-400">P </span>
          <span className="font-semibold text-slate-100">
            {latestU1 ? formatUSD(price, 1) : "—"}
          </span>
        </div>
        <div>
          <span className="text-amber-400/90">ATC </span>
          <span className="text-slate-300">
            {latestU1 ? formatUSD(atc, 1) : "—"}
          </span>
        </div>
        <div>
          <span className="text-cyan-400/90">MC </span>
          <span className="text-slate-300">
            {latestU1 ? formatUSD(mc, 1) : "—"}
          </span>
        </div>
      </div>

      <div className="h-[52px] w-full overflow-hidden rounded border border-slate-800/70 bg-[#080c14]">
        <svg
          viewBox={`0 0 ${geometry.width} ${geometry.height}`}
          className="h-full w-full select-none"
          preserveAspectRatio="none"
        >
          {/* MC dotted line */}
          {geometry.mcPoints && (
            <polyline
              fill="none"
              stroke="#22d3ee"
              strokeWidth="1.2"
              strokeDasharray="2 2"
              points={geometry.mcPoints}
            />
          )}
          {/* ATC dashed line */}
          {geometry.atcPoints && (
            <polyline
              fill="none"
              stroke="#f59e0b"
              strokeWidth="1.3"
              strokeDasharray="4 2"
              points={geometry.atcPoints}
            />
          )}
          {/* Price solid line */}
          {geometry.pPoints && (
            <polyline
              fill="none"
              stroke={accentColor}
              strokeWidth="1.8"
              points={geometry.pPoints}
            />
          )}
        </svg>
      </div>
    </div>
  );
}

type FirmPriceCostSparklineProps = FirmSparklineProps;

export function PriceCostChart({ tickSeries, latestU1 }: PriceCostChartProps) {
  return (
    <section
      aria-label="Price vs Marginal Cost and Average Total Cost"
      className="rounded border border-slate-800/90 bg-[#0f1522] p-2.5"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-cyan-400" />
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-200">
            Price vs MC & ATC (Per Firm)
          </h3>
        </div>
        <div className="flex items-center gap-2 font-mono text-[9px] text-slate-400">
          <span>— P</span>
          <span className="text-amber-300">-- ATC</span>
          <span className="text-cyan-300">·· MC</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <FirmPriceCostSparkline
          firmIdx={0}
          firmName="Firm A"
          accentColor="#a855f7"
          accentTextClass="text-purple-300"
          tickSeries={tickSeries}
          latestU1={latestU1}
        />
        <FirmPriceCostSparkline
          firmIdx={1}
          firmName="Firm B"
          accentColor="#fbbf24"
          accentTextClass="text-amber-300"
          tickSeries={tickSeries}
          latestU1={latestU1}
        />
      </div>
    </section>
  );
}

export default PriceCostChart;
