"use client";

import React, { useEffect, useRef, useState } from "react";
import * as ArenaModule from "../components/Arena";
import * as GroundingCardsModule from "../components/GroundingCards";
import * as TerminalModule from "../components/Terminal";
import {
  BenchmarkExportFormat,
  DecisionRole,
  JobStatus,
  ModelTier,
  RunMode,
} from "../lib/events";
import {
  EpochReasoningGroup,
  ReasoningStreamEntry,
  useMarketStore,
} from "../lib/store";
import {
  connectRunStream,
  disconnectRunStream,
  exportBenchmark,
  getStreamClient,
  submitShock,
} from "../lib/stream";

// Resolve both default and named component exports so parallel replacements in T11 & T12
// never break compilation regardless of export style.
const ArenaComponent: React.ComponentType =
  (
    ArenaModule as {
      default?: React.ComponentType;
      Arena?: React.ComponentType;
    }
  ).default ??
  (ArenaModule as { Arena: React.ComponentType }).Arena;

const TerminalComponent: React.ComponentType =
  (
    TerminalModule as {
      default?: React.ComponentType;
      Terminal?: React.ComponentType;
    }
  ).default ??
  (TerminalModule as { Terminal: React.ComponentType }).Terminal;

const GroundingCardsComponent: React.ComponentType =
  (
    GroundingCardsModule as {
      default?: React.ComponentType;
      GroundingCards?: React.ComponentType;
    }
  ).default ??
  (GroundingCardsModule as { GroundingCards: React.ComponentType })
    .GroundingCards;

function getRoleTheme(
  role: DecisionRole | string,
  tier: ModelTier
): {
  label: string;
  badgeClass: string;
  borderClass: string;
  textClass: string;
  dotClass: string;
} {
  if (role === "ceo_A") {
    return {
      label: "CEO A · ULTRA",
      badgeClass:
        "border-purple-500/50 bg-purple-950/70 text-purple-200",
      borderClass: "border-l-2 border-l-purple-500 border-slate-800/90",
      textClass: "text-purple-200",
      dotClass: "bg-purple-400",
    };
  }
  if (role === "ceo_B") {
    return {
      label: "CEO B · ULTRA",
      badgeClass:
        "border-amber-500/50 bg-amber-950/70 text-amber-200",
      borderClass: "border-l-2 border-l-amber-400 border-slate-800/90",
      textClass: "text-amber-200",
      dotClass: "bg-amber-400",
    };
  }
  if (role === "inventory") {
    return {
      label: "INVENTORY ω · SUPER",
      badgeClass: "border-cyan-500/50 bg-cyan-950/70 text-cyan-200",
      borderClass: "border-l-2 border-l-cyan-400 border-slate-800/90",
      textClass: "text-cyan-200",
      dotClass: "bg-cyan-400",
    };
  }
  if (role === "shock_parser") {
    return {
      label: "SHOCK PARSER · SUPER",
      badgeClass: "border-cyan-500/50 bg-cyan-950/70 text-cyan-200",
      borderClass: "border-l-2 border-l-cyan-400 border-slate-800/90",
      textClass: "text-cyan-200",
      dotClass: "bg-cyan-400",
    };
  }
  if (role === "crowd" || tier === "fast") {
    return {
      label: "CROWD (12) · LIGHTNING",
      badgeClass:
        "border-emerald-500/50 bg-emerald-950/70 text-emerald-200",
      borderClass: "border-l-2 border-l-emerald-400 border-slate-800/90",
      textClass: "text-emerald-200",
      dotClass: "bg-emerald-400",
    };
  }
  return {
    label: String(role).toUpperCase(),
    badgeClass: "border-slate-600 bg-slate-800 text-slate-200",
    borderClass: "border-l-2 border-l-slate-500 border-slate-800",
    textClass: "text-slate-200",
    dotClass: "bg-slate-400",
  };
}

function formatJobBadge(status: JobStatus, sampleN?: number): {
  label: string;
  sublabel: string;
  className: string;
  dotClass: string;
} {
  switch (status) {
    case "verified":
      return {
        label: "Cloud-Verified (n=10,000)",
        sublabel: "JOB: VERIFIED",
        className:
          "border-emerald-500/50 bg-emerald-950/60 text-emerald-200",
        dotClass: "bg-emerald-400",
      };
    case "running":
      return {
        label: `Live (n=${sampleN ?? 100})`,
        sublabel: "MC-10K: RUNNING",
        className: "border-cyan-500/50 bg-cyan-950/60 text-cyan-200",
        dotClass: "bg-cyan-400 animate-pulse",
      };
    case "queued":
      return {
        label: `Live (n=${sampleN ?? 100})`,
        sublabel: "MC-10K: QUEUED",
        className: "border-amber-500/50 bg-amber-950/60 text-amber-200",
        dotClass: "bg-amber-400 animate-pulse",
      };
    case "failed":
      return {
        label: `Live (n=${sampleN ?? 100})`,
        sublabel: "MC-10K: FAILED",
        className: "border-rose-500/50 bg-rose-950/60 text-rose-200",
        dotClass: "bg-rose-400",
      };
    default:
      return {
        label: `Live (n=${sampleN ?? 100})`,
        sublabel: "MC-10K: IDLE",
        className: "border-slate-700 bg-slate-900/80 text-slate-300",
        dotClass: "bg-slate-400",
      };
  }
}

export default function MarketDigitalTwinPage() {
  const scenarios = useMarketStore((s) => s.scenarios);
  const selectedScenarioId = useMarketStore((s) => s.selectedScenarioId);
  const mode = useMarketStore((s) => s.mode);
  const modeReason = useMarketStore((s) => s.modeReason);
  const connectionStatus = useMarketStore((s) => s.connectionStatus);
  const usingMock = useMarketStore((s) => s.usingMock);
  const currentTick = useMarketStore((s) => s.currentTick);
  const currentEpoch = useMarketStore((s) => s.currentEpoch);
  const telemetry = useMarketStore((s) => s.telemetry);
  const stats = useMarketStore((s) => s.stats);
  const reasoningGroups = useMarketStore((s) => s.reasoningGroups);
  const activeReasoningRoles = useMarketStore((s) => s.activeReasoningRoles);
  const lastError = useMarketStore((s) => s.lastError);
  const clearError = useMarketStore((s) => s.clearError);

  const [collapsedEpochs, setCollapsedEpochs] = useState<
    Record<number, boolean>
  >({});
  const [autoScroll, setAutoScroll] = useState(true);
  const [shockText, setShockText] = useState("");
  const [shockFeedback, setShockFeedback] = useState<string | null>(null);
  const [exportFormat, setExportFormat] =
    useState<BenchmarkExportFormat>("md");
  const [exporting, setExporting] = useState(false);

  const reasoningScrollRef = useRef<HTMLDivElement | null>(null);

  // Initialize scenarios and start stream on mount
  useEffect(() => {
    const client = getStreamClient();
    void client.fetchScenarios();
    void connectRunStream(selectedScenarioId, mode);
    return () => {
      disconnectRunStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autoscroll reasoning stream when new chunks or epoch entries arrive
  useEffect(() => {
    if (!autoScroll || !reasoningScrollRef.current) return;
    const el = reasoningScrollRef.current;
    el.scrollTop = el.scrollHeight;
  }, [reasoningGroups, autoScroll]);

  const handleReasoningScroll = () => {
    const el = reasoningScrollRef.current;
    if (!el) return;
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    setAutoScroll(distanceFromBottom < 48);
  };

  const handleScenarioChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextScenarioId = e.target.value;
    setCollapsedEpochs({});
    void connectRunStream(nextScenarioId, mode);
  };

  const handleModeToggle = (nextMode: RunMode) => {
    if (nextMode === mode) return;
    setCollapsedEpochs({});
    void connectRunStream(selectedScenarioId, nextMode);
  };

  const handleShockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shockText.trim()) return;
    setShockFeedback(null);
    const res = await submitShock(shockText.trim());
    if (res.accepted) {
      setShockText("");
      setShockFeedback("Shock dispatched to Super parser.");
      setTimeout(() => setShockFeedback(null), 3000);
    } else {
      setShockFeedback(res.reason ?? "Shock rejected (LIVE mode required).");
    }
  };

  const handleExportBenchmark = async () => {
    setExporting(true);
    try {
      await exportBenchmark(exportFormat);
    } finally {
      setExporting(false);
    }
  };

  const toggleEpochCollapse = (epoch: number) => {
    setCollapsedEpochs((prev) => ({
      ...prev,
      [epoch]: !prev[epoch],
    }));
  };

  const jobBadge = formatJobBadge(telemetry.job.status, stats?.n);

  const callShareUltra = Math.max(0, telemetry.call_share.ultra || 0);
  const callShareSuper = Math.max(0, telemetry.call_share.super || 0);
  const callShareFast = Math.max(0, telemetry.call_share.fast || 0);

  const tokShareUltra = Math.max(0, telemetry.token_share.ultra || 0);
  const tokShareSuper = Math.max(0, telemetry.token_share.super || 0);
  const tokShareFast = Math.max(0, telemetry.token_share.fast || 0);

  const isDeliberating =
    activeReasoningRoles["ceo_A"] || activeReasoningRoles["ceo_B"];

  return (
    <div className="flex min-h-screen w-full flex-col bg-[#07090e] text-slate-100">
      {/* =================================================================== */}
      {/* TOP INSTITUTIONAL HUD                                               */}
      {/* =================================================================== */}
      <header className="sticky top-0 z-30 border-b border-[#1c2536] bg-[#0a0e17]/95 px-3 py-2 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Brand + Connection & Tick Counter */}
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981]" />
              <span className="text-xs font-bold uppercase tracking-widest text-slate-100">
                Market Digital Twin
              </span>
            </div>
            <span className="rounded border border-slate-700/80 bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
              T={currentTick} · E={currentEpoch}
            </span>
            <span
              className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                usingMock
                  ? "border-purple-500/40 bg-purple-950/50 text-purple-300"
                  : connectionStatus === "connected"
                  ? "border-emerald-500/40 bg-emerald-950/50 text-emerald-300"
                  : "border-amber-500/40 bg-amber-950/50 text-amber-300"
              }`}
            >
              {usingMock ? "MOCK/REPLAY STREAM" : connectionStatus}
            </span>
          </div>

          {/* Per-Tier TTFT & tok/s Metrics */}
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
            <div
              className="flex items-center gap-1.5 rounded border border-purple-500/40 bg-purple-950/30 px-2 py-1"
              title="CEO A & B: nvidia/Nemotron-3-Ultra-550b-a55b (Thinking ON)"
            >
              <span className="h-2 w-2 rounded-full bg-gradient-to-r from-purple-400 to-amber-400" />
              <span className="font-semibold text-purple-300">ULTRA</span>
              <span className="text-slate-300">
                {telemetry.tiers.ultra.p50_ttft_ms}ms
              </span>
              <span className="text-amber-300">
                {telemetry.tiers.ultra.tok_per_s} tok/s
              </span>
            </div>

            <div
              className="flex items-center gap-1.5 rounded border border-cyan-500/40 bg-cyan-950/30 px-2 py-1"
              title="Shock Parser & Inventory ω: nvidia/nemotron-3-super-120b-a12b"
            >
              <span className="h-2 w-2 rounded-full bg-cyan-400" />
              <span className="font-semibold text-cyan-300">SUPER</span>
              <span className="text-slate-300">
                {telemetry.tiers.super.p50_ttft_ms}ms
              </span>
              <span className="text-cyan-200">
                {telemetry.tiers.super.tok_per_s} tok/s
              </span>
            </div>

            <div
              className="flex items-center gap-1.5 rounded border border-emerald-500/40 bg-emerald-950/30 px-2 py-1"
              title="Crowd Archetypes: nvidia/Nemotron-3_5-Lightning"
            >
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="font-semibold text-emerald-300">FAST</span>
              <span className="text-slate-300">
                {telemetry.tiers.fast.p50_ttft_ms}ms
              </span>
              <span className="text-emerald-200">
                {telemetry.tiers.fast.tok_per_s} tok/s
              </span>
            </div>
          </div>

          {/* Call-Share / Token-Share Bar */}
          <div className="flex min-w-[210px] flex-col gap-1 rounded border border-slate-800 bg-[#0d131f] px-2.5 py-1">
            <div className="flex items-center justify-between text-[10px] font-mono">
              <span className="text-slate-400">CALLS</span>
              <span className="text-purple-300">
                U {callShareUltra.toFixed(0)}%
              </span>
              <span className="text-cyan-300">
                S {callShareSuper.toFixed(0)}%
              </span>
              <span className="text-emerald-300">
                F {callShareFast.toFixed(0)}%
              </span>
            </div>
            <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="bg-gradient-to-r from-purple-500 to-amber-400 transition-all duration-300"
                style={{ width: `${callShareUltra}%` }}
              />
              <div
                className="bg-cyan-400 transition-all duration-300"
                style={{ width: `${callShareSuper}%` }}
              />
              <div
                className="bg-emerald-400 transition-all duration-300"
                style={{ width: `${callShareFast}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] font-mono">
              <span className="text-slate-400">TOKENS</span>
              <span className="text-amber-300">
                U {tokShareUltra.toFixed(0)}%
              </span>
              <span className="text-cyan-300">
                S {tokShareSuper.toFixed(0)}%
              </span>
              <span className="text-emerald-300">
                F {tokShareFast.toFixed(0)}%
              </span>
            </div>
            <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="bg-gradient-to-r from-purple-500 to-amber-400 transition-all duration-300"
                style={{ width: `${tokShareUltra}%` }}
              />
              <div
                className="bg-cyan-400 transition-all duration-300"
                style={{ width: `${tokShareSuper}%` }}
              />
              <div
                className="bg-emerald-400 transition-all duration-300"
                style={{ width: `${tokShareFast}%` }}
              />
            </div>
          </div>

          {/* Cost & Counterfactual Savings % */}
          <div className="flex items-center gap-2 rounded border border-slate-800 bg-[#0d131f] px-2.5 py-1 font-mono text-[11px]">
            <div>
              <div className="text-[10px] text-slate-400">COST</div>
              <div className="font-bold text-slate-100">
                ${telemetry.cost_usd.toFixed(4)}
              </div>
            </div>
            <div className="h-6 w-px bg-slate-800" />
            <div>
              <div className="text-[10px] text-slate-400">SAVED VS ULTRA</div>
              <div className="font-bold text-emerald-400">
                {telemetry.savings_pct.toFixed(1)}%
              </div>
            </div>
          </div>

          {/* Serverless MC-10k Job Badge */}
          <div
            className={`flex items-center gap-1.5 rounded border px-2.5 py-1 font-mono text-[11px] ${jobBadge.className}`}
          >
            <span className={`h-2 w-2 rounded-full ${jobBadge.dotClass}`} />
            <div>
              <div className="text-[10px] font-bold leading-none">
                {jobBadge.sublabel}
              </div>
              <div className="text-[10px] opacity-90">{jobBadge.label}</div>
            </div>
          </div>

          {/* Scenario Picker + LIVE/REPLAY Toggle + Export Benchmark */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Scenario picker"
              value={selectedScenarioId}
              onChange={handleScenarioChange}
              className="rounded border border-slate-700 bg-[#0d131f] px-2 py-1 text-xs font-medium text-slate-100 outline-none focus:border-cyan-400"
            >
              {scenarios.map((sc) => (
                <option key={sc.id} value={sc.id}>
                  {sc.title}
                </option>
              ))}
            </select>

            <div
              role="group"
              aria-label="Simulation mode toggle"
              className="inline-flex overflow-hidden rounded border border-slate-700 bg-[#0d131f] p-0.5 text-[11px] font-semibold"
            >
              <button
                type="button"
                onClick={() => handleModeToggle("replay")}
                className={`rounded px-2 py-0.5 transition ${
                  mode === "replay"
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                REPLAY
              </button>
              <button
                type="button"
                onClick={() => handleModeToggle("live")}
                className={`rounded px-2 py-0.5 transition ${
                  mode === "live"
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                LIVE
              </button>
            </div>

            <div className="inline-flex items-center rounded border border-slate-700 bg-[#0d131f]">
              <select
                aria-label="Benchmark export format"
                value={exportFormat}
                onChange={(e) =>
                  setExportFormat(e.target.value as BenchmarkExportFormat)
                }
                className="bg-transparent px-1.5 py-1 font-mono text-[11px] text-slate-300 outline-none"
              >
                <option value="md">MD</option>
                <option value="json">JSON</option>
              </select>
              <button
                type="button"
                onClick={handleExportBenchmark}
                disabled={exporting}
                className="border-l border-slate-700 bg-slate-800/80 px-2.5 py-1 text-[11px] font-semibold text-slate-100 transition hover:bg-cyan-950 hover:text-cyan-200 disabled:opacity-50"
              >
                {exporting ? "Exporting…" : "Export Benchmark"}
              </button>
            </div>
          </div>
        </div>

        {/* Spend Guard / Mode Downgrade or Error Banner */}
        {(modeReason || lastError) && (
          <div className="mt-1.5 flex items-center justify-between rounded border border-amber-500/40 bg-amber-950/40 px-2.5 py-1 text-[11px] text-amber-200">
            <span>
              {lastError
                ? `Stream Warning: ${lastError.message}`
                : modeReason}
            </span>
            {lastError && (
              <button
                type="button"
                onClick={clearError}
                className="text-[10px] underline hover:text-white"
              >
                Dismiss
              </button>
            )}
          </div>
        )}
      </header>

      {/* =================================================================== */}
      {/* 3-PANE TERMINAL WORKSPACE (25% LEFT / 45% CENTRE / 30% RIGHT)       */}
      {/* Stacks below 900px wide via .mdt-workspace-grid in globals.css       */}
      {/* =================================================================== */}
      <main className="mdt-workspace-grid flex-1 gap-2 p-2">
        {/* ----------------------------------------------------------------- */}
        {/* LEFT PANE (25%): Shock Input + Grounding Slot + Reasoning Stream  */}
        {/* ----------------------------------------------------------------- */}
        <section className="mdt-pane-left flex flex-col gap-2 overflow-hidden">
          {/* Custom Shock Input Bar (SPEC §9) */}
          <form
            onSubmit={handleShockSubmit}
            className="shrink-0 rounded border border-[#1c2536] bg-[#0c1018] p-2"
          >
            <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-400">
              <span>Inject Supply / Tariff Shock</span>
              <span className="font-mono text-cyan-400">
                {mode === "live" ? "LIVE PARSER READY" : "SWITCH TO LIVE TO INJECT"}
              </span>
            </div>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={shockText}
                onChange={(e) => setShockText(e.target.value)}
                placeholder="e.g. 30% wafer duty + port strike (+3 ticks)…"
                className="min-w-0 flex-1 rounded border border-slate-800 bg-[#07090e] px-2 py-1 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-cyan-500/60"
              />
              <button
                type="submit"
                className="shrink-0 rounded border border-cyan-500/40 bg-cyan-950/60 px-2.5 py-1 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-900/70"
              >
                Apply
              </button>
            </div>
            {shockFeedback && (
              <div className="mt-1 text-[10px] text-amber-300">
                {shockFeedback}
              </div>
            )}
          </form>

          {/* Fixed-Size Slot for GroundingCards (T11 replaces GroundingCards.tsx) */}
          <div className="h-[220px] shrink-0 overflow-hidden">
            <GroundingCardsComponent />
          </div>

          {/* Colour-Coded Reasoning Stream (One Collapsible Group Per Epoch) */}
          <div className="flex min-h-[320px] flex-1 flex-col overflow-hidden rounded border border-[#1c2536] bg-[#0c1018]">
            <div className="flex items-center justify-between border-b border-slate-800/90 px-3 py-2">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${
                    isDeliberating
                      ? "bg-purple-400 animate-ping"
                      : "bg-purple-400"
                  }`}
                />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Nemotron Reasoning Stream
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="rounded border border-purple-500/40 bg-purple-950/60 px-1.5 py-0.5 text-purple-300">
                  Ultra
                </span>
                <span className="rounded border border-cyan-500/40 bg-cyan-950/60 px-1.5 py-0.5 text-cyan-300">
                  Super
                </span>
                <span className="rounded border border-emerald-500/40 bg-emerald-950/60 px-1.5 py-0.5 text-emerald-300">
                  Fast
                </span>
              </div>
            </div>

            <div
              ref={reasoningScrollRef}
              onScroll={handleReasoningScroll}
              className="flex-1 space-y-2 overflow-y-auto p-2.5 font-mono text-xs"
            >
              {reasoningGroups.length === 0 ? (
                <div className="flex h-full items-center justify-center text-center text-[11px] text-slate-500">
                  Initializing decision epoch reasoning stream…
                </div>
              ) : (
                reasoningGroups.map((group: EpochReasoningGroup) => {
                  const isCollapsed = !!collapsedEpochs[group.epoch];
                  return (
                    <div
                      key={group.epoch}
                      className="overflow-hidden rounded border border-slate-800/90 bg-[#090d14]"
                    >
                      <button
                        type="button"
                        onClick={() => toggleEpochCollapse(group.epoch)}
                        className="flex w-full items-center justify-between bg-[#101622] px-2.5 py-1.5 text-left text-[11px] font-semibold text-slate-200 hover:bg-slate-800/70"
                      >
                        <span>
                          Epoch #{group.epoch}{" "}
                          <span className="font-normal text-slate-400">
                            (Ticks {group.startTick}–{group.endTick})
                          </span>
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {group.entries.length} events{" "}
                          {isCollapsed ? "▸" : "▾"}
                        </span>
                      </button>

                      {!isCollapsed && (
                        <div className="space-y-1.5 p-2">
                          {group.entries.map((entry: ReasoningStreamEntry) => {
                            const theme = getRoleTheme(entry.role, entry.tier);
                            return (
                              <div
                                key={entry.id}
                                className={`rounded border bg-[#0c111b] p-2 ${theme.borderClass}`}
                              >
                                <div className="mb-1 flex items-center justify-between gap-1">
                                  <span
                                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold ${theme.badgeClass}`}
                                  >
                                    <span
                                      className={`h-1.5 w-1.5 rounded-full ${theme.dotClass}`}
                                    />
                                    {theme.label}
                                  </span>
                                  <span className="text-[10px] text-slate-400">
                                    T{entry.tick}
                                    {entry.decision
                                      ? ` · ${entry.decision.latency_ms}ms`
                                      : " · streaming…"}
                                  </span>
                                </div>

                                <p
                                  className={`whitespace-pre-wrap text-[11px] leading-relaxed ${theme.textClass}`}
                                >
                                  {entry.text}
                                  {!entry.done && (
                                    <span className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-purple-400 align-middle" />
                                  )}
                                </p>

                                {entry.decision &&
                                  (entry.role === "ceo_A" ||
                                    entry.role === "ceo_B") && (
                                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 border-t border-slate-800/80 pt-1 text-[10px] text-slate-300">
                                      <span className="rounded bg-slate-900 px-1.5 py-0.5">
                                        P=$
                                        {Number(
                                          (
                                            entry.decision.decision as Record<
                                              string,
                                              unknown
                                            >
                                          ).price ?? 0
                                        ).toFixed(2)}
                                      </span>
                                      <span className="rounded bg-slate-900 px-1.5 py-0.5">
                                        Q=
                                        {Number(
                                          (
                                            entry.decision.decision as Record<
                                              string,
                                              unknown
                                            >
                                          ).production_qty ?? 0
                                        ).toFixed(0)}
                                      </span>
                                      <span className="rounded bg-slate-900 px-1.5 py-0.5">
                                        M=$
                                        {Number(
                                          (
                                            entry.decision.decision as Record<
                                              string,
                                              unknown
                                            >
                                          ).marketing_budget ?? 0
                                        ).toFixed(0)}
                                      </span>
                                      {entry.decision.fallback_used && (
                                        <span className="rounded bg-amber-950 px-1.5 py-0.5 text-amber-300">
                                          Fallback
                                        </span>
                                      )}
                                    </div>
                                  )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {!autoScroll && (
              <button
                type="button"
                onClick={() => {
                  setAutoScroll(true);
                  if (reasoningScrollRef.current) {
                    reasoningScrollRef.current.scrollTop =
                      reasoningScrollRef.current.scrollHeight;
                  }
                }}
                className="border-t border-purple-500/40 bg-purple-950/80 py-1 text-center text-[11px] font-semibold text-purple-200 hover:bg-purple-900/80"
              >
                ↓ Resume Autoscroll
              </button>
            )}
          </div>
        </section>

        {/* ----------------------------------------------------------------- */}
        {/* CENTRE PANE (45%): Fixed-Size Arena Slot (T12 replaces Arena.tsx) */}
        {/* ----------------------------------------------------------------- */}
        <section className="mdt-pane-centre flex min-h-[480px] flex-col overflow-hidden">
          <div className="h-full w-full flex-1 overflow-hidden">
            <ArenaComponent />
          </div>
        </section>

        {/* ----------------------------------------------------------------- */}
        {/* RIGHT PANE (30%): Fixed-Size Terminal Slot (T11 replaces it)      */}
        {/* ----------------------------------------------------------------- */}
        <section className="mdt-pane-right flex min-h-[480px] flex-col overflow-hidden">
          <div className="h-full w-full flex-1 overflow-hidden">
            <TerminalComponent />
          </div>
        </section>
      </main>
    </div>
  );
}

