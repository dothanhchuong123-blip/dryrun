"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentStepKind, AgentTier } from "../../lib/events";
import { formatDelta, formatRuns } from "../../lib/format";
import { cellKey, reasoningKey, useMarketStore, type AgentStepRow } from "../../lib/store";
import "./analyst.css";

const TAG: Record<AgentStepKind, string> = {
  think: "Think",
  test: "Test",
  result: "Result",
  shoppers: "Shoppers",
  finish: "Pick",
  fallback: "Fallback",
};
const TIER: Record<AgentTier, string> = { ultra: "Ultra", super: "Super", fast: "Lightning", engine: "Engine" };
const FUTURES_ID = "futures";

interface Group {
  id: string;
  round: number | null; // null = the futures group
  title: string;
  steps: AgentStepRow[];
  thinkKey: string;
}

const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function roundTitle(r: number): string {
  return r === 0 ? "Starting plans" : `Round ${r}`;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** The analyst log, left column of screen 3. Scrolls inside itself, never the page. */
export function AnalystLog() {
  const steps = useMarketStore((s) => s.agentSteps);
  const status = useMarketStore((s) => s.analysis.status);
  const scenarios = useMarketStore((s) => s.scenarios);
  const reasoning = useMarketStore((s) => s.reasoningByRound);
  const reasoningDone = useMarketStore((s) => s.reasoningDone);
  const shocks = useMarketStore((s) => s.shocks);
  const plans = useMarketStore((s) => s.plans);
  const cells = useMarketStore((s) => s.cells);
  const memo = useMarketStore((s) => s.memo);
  const reduced = useReducedMotion();

  const [openUser, setOpenUser] = useState<Record<string, boolean>>({});
  const [thinkUser, setThinkUser] = useState<Record<string, boolean>>({});
  const bodyRef = useRef<HTMLDivElement>(null);

  const groups = useMemo<Group[]>(() => {
    const out: Group[] = [];
    if (scenarios || reasoning[reasoningKey("scenarios", 0)]) {
      out.push({ id: FUTURES_ID, round: null, title: "Futures to test", steps: [], thinkKey: reasoningKey("scenarios", 0) });
    }
    const byRound = new Map<number, AgentStepRow[]>();
    for (const s of steps) byRound.set(s.round, [...(byRound.get(s.round) ?? []), s]);
    // a round can have streaming reasoning before its first step arrives
    for (const k of Object.keys(reasoning)) {
      const [role, r] = k.split(":");
      if (role === "analyst" && !byRound.has(Number(r))) byRound.set(Number(r), []);
    }
    for (const r of [...byRound.keys()].sort((a, b) => a - b)) {
      out.push({ id: `round-${r}`, round: r, title: roundTitle(r), steps: byRound.get(r)!, thinkKey: reasoningKey("analyst", r) });
    }
    return out;
  }, [steps, scenarios, reasoning]);

  const runEnded = status === "done" || status === "error";
  const newsId = shocks.find((s) => s.id === "news")?.id ?? shocks[0]?.id;

  // keep the newest content in view, unless the reader has scrolled up
  const nearBottom = useRef(true);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const on = () => {
      nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
    };
    el.addEventListener("scroll", on, { passive: true });
    return () => el.removeEventListener("scroll", on);
  }, []);
  const lastLen = steps.length + groups.length;
  useEffect(() => {
    const el = bodyRef.current;
    if (el && nearBottom.current) el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [lastLen, reduced]);

  const statusText = useMemo(() => {
    if (status === "starting") return "Starting the analysis…";
    if (status !== "running") return null;
    const waiting = plans.find((p) => shocks.some((s) => !cells[cellKey(p.name, s.id)]));
    if (waiting && shocks.length) return `Testing '${clip(waiting.name, 40)}' in ${shocks.length} situations…`;
    const last = steps[steps.length - 1];
    if (memo) return null;
    if (last?.kind === "finish") return "Nemotron is writing the memo…";
    if (last?.kind === "result" || last?.kind === "shoppers") return "Nemotron is deciding what to test next…";
    return "Nemotron Ultra is thinking…";
  }, [status, plans, shocks, cells, steps, memo]);

  const empty = groups.length === 0;

  return (
    <div className={`card al liquid${status === "running" || status === "starting" ? " on" : ""}`} data-slot="AnalystLog">
      <div className="al-head">
        <div>
          <h2>Analyst log</h2>
          <p>Nemotron decides what to test. The engine computes every number.</p>
        </div>
        <div className="al-chips">
          <span className="mchip t-ultra"><i className="dot" />Ultra · analyst</span>
          <span className="mchip t-fast"><i className="dot" />Lightning · shoppers</span>
        </div>
      </div>

      <div className="al-body" ref={bodyRef} aria-label="Analyst log">
        {empty && <div className="empty">Nemotron's steps appear here: what it thinks, what it tests, what it learns.</div>}
        {groups.map((g, gi) => {
          const finished = runEnded || gi < groups.length - 1;
          const open = openUser[g.id] ?? !finished;
          const text = reasoning[g.thinkKey] ?? "";
          const thinkDone = !!reasoningDone[g.thinkKey];
          const streaming = !!text && !thinkDone;
          const thinkOpen = thinkUser[g.thinkKey] ?? streaming;
          const thinkStep = g.steps.find((s) => s.kind === "think");
          const takeaway =
            g.round === null
              ? `${shocks.length || "A few"} futures${scenarios?.thought ? ": " + clip(scenarios.thought, 90) : ""}`
              : clip(g.steps.filter((s) => s.kind === "result").map((s) => s.text).join(" ") || g.steps[g.steps.length - 1]?.text || "", 110);
          const meta =
            g.round === null
              ? "Nemotron Ultra"
              : `Nemotron Ultra${thinkStep?.latency_ms ? ` · thought for ${Math.round(thinkStep.latency_ms / 1000)} s` : ""}`;
          return (
            <section key={g.id} className={`al-group${open ? " open" : ""}`} data-round={g.round ?? "futures"}>
              <button
                className="al-gh"
                aria-expanded={open}
                onClick={() => setOpenUser((o) => ({ ...o, [g.id]: !open }))}
              >
                <b>{g.title}</b>
                {open ? <span className="al-meta">{meta}</span> : <span className="al-take">{takeaway}</span>}
                <span className="al-car" aria-hidden>▸</span>
              </button>
              <div className="al-gb">
                <div>
                  {g.round === null && scenarios && (
                    <div className="al-rows">
                      <div className={`al-row k-${scenarios.fallback_used ? "fallback" : "think"} new`}>
                        <span className="tag">{scenarios.fallback_used ? "Fallback" : "Think"}</span>
                        <div className="al-text">
                          {scenarios.thought}
                          <div className="al-m">
                            <span>Ultra</span>
                            {shocks.length > 0 && <span className="rchip">{shocks.length} futures</span>}
                            {scenarios.unmodelled.length > 0 && <span className="rchip">{scenarios.unmodelled.length} risks not modelled</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {g.steps.length > 0 && (
                    <div className="al-rows">
                      {g.steps.map((r) => (
                        <StepRow key={r.seq} r={r} runs={Object.values(cells)[0]?.n} futures={shocks.length} newsId={newsId} />
                      ))}
                    </div>
                  )}
                  {text && (
                    <>
                      <button
                        className="al-tbtn"
                        aria-expanded={thinkOpen}
                        onClick={() => setThinkUser((o) => ({ ...o, [g.thinkKey]: !thinkOpen }))}
                      >
                        {streaming && <span className="al-live" />}
                        {thinkOpen ? "Hide Nemotron thinking ▴" : "Show full Nemotron thinking ▾"}
                      </button>
                      {thinkOpen && <ThinkText text={text} follow={streaming} />}
                    </>
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </div>

      <div className="al-status" role="status" aria-live="polite">
        {statusText ? (
          <>
            <span className="al-dots" aria-hidden><i /><i /><i /></span>
            <span>{statusText}</span>
          </>
        ) : status === "done" ? (
          <span className="muted">Done. {plans.length} plans tested.</span>
        ) : status === "error" ? (
          <span className="neg">The run stopped early.</span>
        ) : null}
      </div>
    </div>
  );
}

function ThinkText({ text, follow }: { text: string; follow: boolean }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [text, follow]);
  return (
    <pre className="al-think" ref={ref} tabIndex={0}>
      {text}
    </pre>
  );
}

function StepRow({ r, runs, futures, newsId }: { r: AgentStepRow; runs?: number; futures: number; newsId?: string }) {
  const cell = useMarketStore((s) => (r.plan_name && newsId ? s.cells[cellKey(r.plan_name, newsId)] : undefined));
  return (
    <div className={`al-row k-${r.kind} new`}>
      <span className="tag">{TAG[r.kind]}</span>
      <div className="al-text">
        {r.text}
        <div className="al-m">
          <span>{r.kind === "shoppers" ? "Lightning · shopper groups" : TIER[r.tier]}</span>
          {r.latency_ms != null && <span className="num">· {secs(r.latency_ms)}</span>}
          {r.kind === "test" && futures > 0 && (
            <span className="rchip num">{formatRuns(runs ?? 1000)} runs × {futures}</span>
          )}
          {r.kind === "result" && cell && (
            <>
              <span className={`rchip num ${cell.mean_delta_usd >= 0 ? "pos" : "neg"}`}>today {formatDelta(cell.mean_delta_usd)}</span>
              <span className="rchip num">bad case {formatDelta(cell.p5_delta_usd)}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default AnalystLog;
