"use client";

import React from "react";
import { JobStatus, StatsEventData } from "../../lib/events";
import {
  formatCI95,
  formatInt,
  formatPValue,
  formatSignedCurrency,
  formatStat,
  isValidNumber,
} from "../../lib/format";

export interface StatsTableProps {
  stats: StatsEventData | null;
  jobStatus?: JobStatus;
}

export function StatsTable({ stats, jobStatus = "idle" }: StatsTableProps) {
  const isCloud =
    stats?.source === "cloud" ||
    jobStatus === "verified" ||
    (stats?.n ?? 0) >= 10_000;
  const sampleN = stats?.n ?? (isCloud ? 10_000 : 100);

  const noVariation =
    stats !== null &&
    stats.cohens_d === 0 &&
    (stats.ci95?.[0] ?? 0) === (stats.ci95?.[1] ?? 0);

  const deltaDisplay = stats ? formatSignedCurrency(stats.delta_mean, 1) : "—";
  const ciDisplay = stats ? formatCI95(stats.ci95, true) : "—";
  const cohensDDisplay = stats
    ? noVariation
      ? "no variation"
      : isValidNumber(stats.cohens_dz)
      ? `${formatStat(stats.cohens_d, 2)} (dz=${formatStat(stats.cohens_dz, 2)})`
      : formatStat(stats.cohens_d, 2)
    : "—";
  const pDisplay = stats
    ? noVariation
      ? "no variation"
      : formatPValue(stats.p_value)
    : "—";
  const chi2Display =
    stats && isValidNumber(stats.chi2) ? formatStat(stats.chi2, 2) : "—";
  const chi2PDisplay =
    stats && isValidNumber(stats.chi2_p) ? formatPValue(stats.chi2_p) : "—";
  const nDisplay = formatInt(sampleN);

  return (
    <section
      aria-label="Econometric Hypothesis Tests"
      className="rounded border border-slate-800/90 bg-[#0f1522] p-2.5"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-200">
            Econometric Stats (CRN Paired t & χ²)
          </h3>
        </div>
        <span
          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums ${
            isCloud
              ? "border-emerald-500/40 bg-emerald-950/70 text-emerald-300"
              : "border-cyan-500/40 bg-cyan-950/70 text-cyan-300"
          }`}
        >
          {isCloud
            ? `Cloud-Verified (n=${nDisplay})`
            : `Live (n=${nDisplay})`}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-1.5 font-mono text-[10px] tabular-nums">
        <div className="rounded border border-slate-800/90 bg-[#0b101b] px-2 py-1">
          <div className="text-[9px] text-slate-400">Δπ (Mean)</div>
          <div
            data-testid="stat-delta-pi"
            className="truncate text-[11px] font-bold text-emerald-400"
          >
            {deltaDisplay}
          </div>
        </div>

        <div className="col-span-2 rounded border border-slate-800/90 bg-[#0b101b] px-2 py-1">
          <div className="text-[9px] text-slate-400">CI95 (Δπ)</div>
          <div
            data-testid="stat-ci95"
            className="truncate text-[11px] font-bold text-slate-200"
          >
            {ciDisplay}
          </div>
        </div>

        <div className="rounded border border-slate-800/90 bg-[#0b101b] px-2 py-1">
          <div className="text-[9px] text-slate-400">Paths (n)</div>
          <div
            data-testid="stat-n"
            className="truncate text-[11px] font-bold text-cyan-300"
          >
            {nDisplay}
          </div>
        </div>

        <div className="rounded border border-slate-800/90 bg-[#0b101b] px-2 py-1">
          <div className="text-[9px] text-slate-400">Cohen&apos;s d</div>
          <div
            data-testid="stat-cohens-d"
            className="truncate text-[11px] font-bold text-purple-300"
          >
            {cohensDDisplay}
          </div>
        </div>

        <div className="rounded border border-slate-800/90 bg-[#0b101b] px-2 py-1">
          <div className="text-[9px] text-slate-400">p (t-test)</div>
          <div
            data-testid="stat-p-value"
            className="truncate text-[11px] font-bold text-slate-200"
          >
            {pDisplay}
          </div>
        </div>

        <div className="rounded border border-slate-800/90 bg-[#0b101b] px-2 py-1">
          <div className="text-[9px] text-slate-400">χ² (Switch)</div>
          <div
            data-testid="stat-chi2"
            className="truncate text-[11px] font-bold text-amber-300"
          >
            {chi2Display}
          </div>
        </div>

        <div className="rounded border border-slate-800/90 bg-[#0b101b] px-2 py-1">
          <div className="text-[9px] text-slate-400">χ² p</div>
          <div
            data-testid="stat-chi2-p"
            className="truncate text-[11px] font-bold text-slate-200"
          >
            {chi2PDisplay}
          </div>
        </div>
      </div>
    </section>
  );
}

export default StatsTable;
