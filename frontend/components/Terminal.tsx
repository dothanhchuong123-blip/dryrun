"use client";

import React from "react";
import { useMarketStore } from "../lib/store";
import { BullwhipGauge } from "./terminal/BullwhipGauge";
import { InventoryChart } from "./terminal/InventoryChart";
import { NashMatrix } from "./terminal/NashMatrix";
import { PriceCostChart } from "./terminal/PriceCostChart";
import { ProfitChart } from "./terminal/ProfitChart";
import { StatsTable } from "./terminal/StatsTable";

export interface TerminalProps {
  className?: string;
}

/**
 * Right-pane Econometric Terminal (30% width).
 * Renders:
 * 1. Profit chart (Firm A cumulative profit U1 AI vs U2 Baseline + CI fan + n/verification badge)
 * 2. Inventory vs ROP chart for each firm + stockout spillover counter
 * 3. Bullwhip gauge for each firm (strictly blank while value is null)
 * 4. 3x3 Bertrand Nash matrix ((π_A, π_B), pure NE outline, chosen fill, regime chip)
 * 5. Stats table (Δπ, CI95, Cohen's d, p, χ², χ² p, n)
 * 6. Mini chart: Price vs MC and ATC per firm
 */
export function Terminal({ className = "" }: TerminalProps) {
  const tickSeries = useMarketStore((s) => s.tickSeries);
  const latestU1 = useMarketStore((s) => s.latestU1);
  const spilloverTotal = useMarketStore((s) => s.spilloverTotal);
  const nash = useMarketStore((s) => s.nash);
  const stats = useMarketStore((s) => s.stats);
  const telemetry = useMarketStore((s) => s.telemetry);
  const latestDecisions = useMarketStore((s) => s.latestDecisions);
  const currentTick = useMarketStore((s) => s.currentTick);

  const inventoryDecision = latestDecisions.inventory?.decision as
    | { omega?: number }
    | undefined;
  const omega =
    typeof inventoryDecision?.omega === "number"
      ? inventoryDecision.omega
      : null;

  return (
    <div
      data-testid="econometric-terminal"
      className={`flex h-full w-full flex-col gap-2.5 overflow-y-auto rounded border border-slate-800/90 bg-[#0b0f17] p-2.5 text-xs ${className}`}
    >
      {/* Terminal Top Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-800/80 pb-1.5">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
          <span className="font-bold uppercase tracking-wider text-slate-200">
            Econometric Terminal
          </span>
        </div>
        <span className="rounded border border-slate-700/80 bg-slate-900 px-2 py-0.5 font-mono text-[10px] text-slate-300 tabular-nums">
          Window: {tickSeries.length}/120t · c_raw=$
          {(latestU1?.c_raw ?? 0).toFixed(1)} · L={latestU1?.lead_time ?? 0}t
        </span>
      </div>

      {/* 1. Cumulative Profit AI (U1) vs Baseline (U2) + CI Fan */}
      <ProfitChart
        tickSeries={tickSeries}
        stats={stats}
        jobStatus={telemetry.job.status}
      />

      {/* 2. Inventory vs ROP + Stockout Spillover Counter */}
      <InventoryChart
        tickSeries={tickSeries}
        latestU1={latestU1}
        spilloverTotal={spilloverTotal}
        omega={omega}
      />

      {/* 3. Bullwhip Ratio Gauge (blank while null) */}
      <BullwhipGauge
        bullwhip={latestU1?.bullwhip}
        currentTick={currentTick}
      />

      {/* 4. 3x3 Bertrand Nash Equilibrium Matrix */}
      <NashMatrix nash={nash} />

      {/* 5. Paired t-Test & Brand-Switch Chi-Square Stats Table */}
      <StatsTable stats={stats} jobStatus={telemetry.job.status} />

      {/* 6. Price vs MC & ATC Mini Chart per Firm */}
      <PriceCostChart tickSeries={tickSeries} latestU1={latestU1} />
    </div>
  );
}

export default Terminal;
