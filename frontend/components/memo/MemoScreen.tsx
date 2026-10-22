"use client";

import { useState } from "react";
import type { CellBridge, MemoEventData, PlanSpec } from "../../lib/events";
import { formatDelta, formatMoney, formatRuns } from "../../lib/format";
import { useMarketStore } from "../../lib/store";
import { api } from "../../lib/stream";
import { withTransition } from "../../lib/transition";
import { ModelChip } from "../shell/ModelChip";
import "./memo.css";

/** The review fields (EVENTS v2.1 "(review)") that lib/events.ts doesn't carry yet. Both are optional. */
type MemoView = MemoEventData & {
  actions?: { week: number; text: string }[];
  runner_up?: { name: string; mean_delta_usd: number; p5_delta_usd: number; why_not: string } | null;
};

const MINUS = "−";

/** The plan in plain words: "Buy 4 extra weeks of stock this week · raise price 3% from week 3". */
/** (v2.2) a price change that stops before the horizon ends, e.g. a surcharge */
const endsEarly = (s: PlanSpec) => (s.price_end_week ?? 24) < 24 && (s.price_end_week ?? 24) > s.price_change_week;

export function describePlan(s: PlanSpec): string {
  const parts: string[] = [];
  if (s.extra_stock_weeks > 0) {
    parts.push(`Buy ${s.extra_stock_weeks} extra ${s.extra_stock_weeks === 1 ? "week" : "weeks"} of stock ${s.stock_week <= 0 ? "this week" : `in week ${s.stock_week}`}`);
  }
  if (s.price_change_pct !== 0) {
    const p = Math.abs(s.price_change_pct);
    parts.push(`${s.price_change_pct > 0 ? "raise" : "lower"} price ${p}% ${s.price_change_week <= 0 ? "now" : `from week ${s.price_change_week}`}${endsEarly(s) ? ` until week ${s.price_end_week}` : ""}`);
  }
  if (s.marketing_change_pct !== 0) {
    parts.push(`${s.marketing_change_pct > 0 ? "spend" : "cut"} ${Math.abs(s.marketing_change_pct)}% ${s.marketing_change_pct > 0 ? "more" : "less"} on marketing`);
  }
  if (s.switch_supplier) {
    const c = s.alt_cost_change_pct;
    parts.push(`switch supplier (${c === 0 ? "same price" : `${c > 0 ? "+" : MINUS}${Math.abs(c)}% cost`}, ${s.alt_lead_time_weeks} wk delivery)`);
  }
  if (parts.length === 0) return "Change nothing";
  const t = parts.join(" · ");
  return t[0].toUpperCase() + t.slice(1);
}

const BRIDGE_LABELS: [keyof CellBridge, string][] = [
  ["cost_usd", "Cheaper stock"],
  ["price_usd", "Your price change"],
  ["volume_usd", "Customers won/lost"],
  ["marketing_usd", "Marketing"],
  ["holding_usd", "Storage & money tied up"],
];

/** Five bars that add up, plus a total. */
function Waterfall({ bridge, total }: { bridge: CellBridge; total: number }) {
  const W = 640;
  const H = 190;
  const top = 26;
  const base = H - 44;
  let run = 0;
  const bars = BRIDGE_LABELS.map(([k, label]) => {
    const v = bridge[k];
    const from = run;
    run += v;
    return { label, v, from, to: run };
  });
  const all = [0, ...bars.flatMap((b) => [b.from, b.to]), total];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const y = (v: number) => top + (1 - (v - lo) / span) * (base - top);
  const n = bars.length + 1;
  const slot = W / n;
  const bw = Math.min(64, slot - 22);
  const wrap = (s: string) => (s.length > 14 ? [s.slice(0, s.lastIndexOf(" ", 14) > 0 ? s.lastIndexOf(" ", 14) : 14), s.slice(s.lastIndexOf(" ", 14) > 0 ? s.lastIndexOf(" ", 14) + 1 : 14)] : [s]);
  const all6 = [...bars, { label: "Total", v: total, from: 0, to: total, total: true }];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mm-wf" role="img" aria-label="Where the money comes from">
      <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" />
      {all6.map((b, i) => {
        const x = i * slot + (slot - bw) / 2;
        const y1 = y(Math.max(b.from, b.to));
        const y2 = y(Math.min(b.from, b.to));
        const color = "total" in b ? "var(--firm-a)" : b.v >= 0 ? "var(--gain)" : "var(--loss)";
        const lines = wrap(b.label);
        return (
          <g key={b.label}>
            {i > 0 && i < n - 1 && <line x1={x - (slot - bw)} x2={x} y1={y(b.from)} y2={y(b.from)} stroke="var(--line-strong)" strokeDasharray="2 3" />}
            <rect x={x} y={y1} width={bw} height={Math.max(2, y2 - y1)} rx="3" fill={color} opacity={"total" in b ? 1 : 0.9} />
            <text x={x + bw / 2} y={y1 - 6} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--ink)" className="num">
              {formatDelta(b.v)}
            </text>
            {lines.map((l, j) => (
              <text key={j} x={x + bw / 2} y={base + 16 + j * 13} textAnchor="middle" fontSize="11" fill="var(--ink-3)">
                {l}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/** Skill vs luck: how much of the gain survives a rival who never runs out. */
function SkillLuck({ mean, steady, rival }: { mean: number; steady: number | null; rival: string }) {
  if (steady == null) return null;
  const extra = mean - steady;
  const bar = mean > 0 && steady >= 0 && extra >= 0;
  return (
    <div className="mm-skill">
      {bar && (
        <div className="mm-bar" aria-hidden>
          <i className="skill" style={{ width: `${(steady / mean) * 100}%` }} />
          <i className="luck" style={{ width: `${(extra / mean) * 100}%` }} />
        </div>
      )}
      <p>
        <span className="k"><i className="skill" /> With a rival who never runs out: <b className="num">{formatDelta(steady)}</b></span>
        <span className="k"><i className="luck" /> Extra if {rival} runs short: <b className="num">{formatDelta(extra)}</b></span>
      </p>
      {bar && extra > steady && <p className="muted">Most of this gain depends on {rival} running short. Treat it as a bonus, not a plan.</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mm-sec">
      <h3>{title}</h3>
      <div>{children}</div>
    </section>
  );
}

function RecheckButton() {
  const newsCheck = useMarketStore((s) => s.newsCheck);
  const live = useMarketStore((s) => s.news.filter((n) => n.live && !n.applied));
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setState("busy");
    setErr(null);
    const e = await newsCheck();
    if (e) setErr(e);
    setState("done");
  };
  return (
    <div className="mm-recheck">
      <button className="btn ghost sm" onClick={() => void go()} disabled={state === "busy"}>
        {state === "busy" ? "Checking the news…" : "Check the news now"}
      </button>
      <span className="muted"> Uses 1 search credit.</span>
      {err && <p className="mm-note" role="status">{err}</p>}
      {state === "done" && !err && live.length === 0 && <p className="mm-note" role="status">Nothing new turned up yet. Try again later.</p>}
      {live.length > 0 && (
        <ul className="mm-live">
          {live.map((n) => (
            <li key={n.id}>
              <a href={n.url} target="_blank" rel="noreferrer noopener">{n.title}</a>
              <span className="muted"> · {n.source}{n.published ? ` · ${n.published}` : ""}</span>
              {n.impact_usd != null && <span className={`rchip ${n.impact_usd < 0 ? "neg" : "pos"}`}> {formatDelta(n.impact_usd)} if you do nothing</span>}
              {n.quote && <q>{n.quote}</q>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MemoScreen() {
  const memoRaw = useMarketStore((s) => s.memo);
  const profile = useMarketStore((s) => s.profile);
  const plans = useMarketStore((s) => s.plans);
  const news = useMarketStore((s) => s.news);
  const analysisId = useMarketStore((s) => s.analysis.id);
  const download = useMarketStore((s) => s.downloadMemo);
  const reset = useMarketStore((s) => s.reset);
  const setStep = useMarketStore((s) => s.setStep);
  const openReplay = useMarketStore((s) => s.openReplay);
  const [copied, setCopied] = useState<string | null>(null);

  if (!memoRaw) {
    return (
      <section className="screen" data-slot="MemoScreen">
        <div className="wrap">
          <div className="card empty">The memo appears when Nemotron has tested the plans (about 25 s).</div>
        </div>
      </section>
    );
  }
  const memo = memoRaw as MemoView;
  const n = memo.numbers;
  const rival = profile?.rival_name ?? "the rival";
  const spec = plans.find((p) => p.name === memo.plan_name)?.spec;
  const flash = (t: string) => {
    setCopied(t);
    setTimeout(() => setCopied(null), 2200);
  };

  const copy = async () => {
    let text = "";
    try {
      text = await api.memoMarkdown(analysisId ?? "", memo);
    } catch {
      text = `# ${memo.headline}\n\n${memo.why}\n\n${memo.watch_out}\n\n${memo.recheck_when}\n`;
    }
    try {
      await navigator.clipboard.writeText(text);
      flash("Memo copied");
    } catch {
      // clipboard blocked: fall back to a hidden textarea
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      ta.remove();
      flash(ok ? "Memo copied" : "Copy was blocked here. Use Download .md instead.");
    }
  };

  const watch = () => {
    withTransition(() => setStep("analyst"));
    void openReplay(memo.plan_name, "news");
  };

  const cashLine =
    n.peak_cash_usd > 0
      ? n.over_cash
        ? `Needs about ${formatMoney(n.peak_cash_usd)} up front. That is over the ${formatMoney(n.cash_available)} you said you have.`
        : `Needs about ${formatMoney(n.peak_cash_usd)} up front${n.payback_week != null ? ` · pays back by week ${n.payback_week}` : ""}`
      : null;
  const bad = n.p5_delta_usd;
  const sourceUrl = (id: string | null) => (id ? news.find((x) => x.id === id)?.url : undefined);

  return (
    <section className="screen" data-slot="MemoScreen">
      <div className="wrap mm-wrap">
        <div className="sub">
          {profile && <span className="biz">{profile.business_name}</span>}
          <span className="muted" style={{ fontSize: 13 }}>Decision memo · every number comes from the simulator</span>
          <div className="mm-btns">
            <button className="btn ghost sm" onClick={() => void copy()}>Copy</button>
            <button className="btn ghost sm" onClick={() => void download()}>Download .md</button>
            <button className="btn ghost sm" onClick={watch}>▶ Watch this plan play out</button>
            <button className="btn sm" onClick={() => withTransition(reset, "back")}>Try another business</button>
          </div>
        </div>
        {copied && <div className="mm-toast" role="status">{copied}</div>}

        <article className="card mm">
          {memo.fallback_used && <p className="mm-fallback">Nemotron was unavailable, so this memo used the built-in rules.</p>}
          <header>
            <h1 className="mm-h" style={{ viewTransitionName: "pick" }}>{memo.headline}</h1>
            {memo.cost_line && <p className="mm-cost num">{memo.cost_line}</p>}
          </header>

          {memo.actions && memo.actions.length > 0 && (
            <ol className="mm-actions" aria-label="What to do, week by week">
              {memo.actions.map((a, i) => (
                <li key={i}>
                  <span className="wk num">{a.week <= 0 ? "Now" : `Week ${a.week}`}</span>
                  <span>{a.text}</span>
                </li>
              ))}
            </ol>
          )}

          <div className="mm-kpis">
            <div>
              <b className={`num ${n.mean_delta_usd >= 0 ? "pos" : "neg"}`}>{formatDelta(n.mean_delta_usd)}</b>
              <span>vs doing nothing (6 months)</span>
            </div>
            <div>
              <b className={`num ${bad >= 0 ? "pos" : "neg"}`}>{formatDelta(bad)}</b>
              <span>Bad case (1 in 20)</span>
            </div>
            <div>
              <b className="num">{formatRuns(n.n)} runs</b>
              <span className={n.verified ? "ver" : ""}>{n.verified ? "verified on Nebius" : "simulated here"}</span>
            </div>
          </div>

          <div className="mm-two">
            <div>
              <h3>Where the money comes from</h3>
              <Waterfall bridge={n.bridge} total={n.mean_delta_usd} />
            </div>
            <div>
              <h3>Skill or luck?</h3>
              <SkillLuck mean={n.mean_delta_usd} steady={n.steady_rival_delta_usd} rival={rival} />
              {cashLine && <p className={`mm-cash${n.over_cash ? " over" : ""}`}>{cashLine}</p>}
            </div>
          </div>

          {spec && (
            <Section title="The plan in detail">
              <p>{describePlan(spec)}</p>
            </Section>
          )}
          <Section title="Why"><p>{memo.why}</p></Section>
          {memo.runner_up && (
            <Section title={`Why not ${memo.runner_up.name}?`}>
              <p>
                <span className="num">{formatDelta(memo.runner_up.mean_delta_usd)}</span> on average, bad case{" "}
                <span className="num">{formatDelta(memo.runner_up.p5_delta_usd)}</span>. {memo.runner_up.why_not}
              </p>
            </Section>
          )}
          <Section title="Watch out for"><p>{memo.watch_out}</p></Section>
          <Section title="Recheck when">
            <p>{memo.recheck_when}</p>
            <RecheckButton />
          </Section>

          <Section title="Sources">
            {memo.sources.length === 0 ? (
              <p className="muted">No headlines were used for this memo.</p>
            ) : (
              <ul className="mm-src">
                {memo.sources.map((s, i) => (
                  <li key={i}>
                    <a href={s.url} target="_blank" rel="noreferrer noopener">{s.title}</a>
                    {s.quote && <q>{s.quote}</q>}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <aside className="mm-notin" aria-label="Not in these numbers">
            <h3>Not in these numbers</h3>
            <ul>
              {memo.not_modelled.fixed.map((f, i) => <li key={`f${i}`}>{f}</li>)}
              {memo.not_modelled.found.map((f, i) => {
                const url = sourceUrl(f.source_id);
                return (
                  <li key={`x${i}`}>
                    {f.text}
                    {url && <> <a href={url} target="_blank" rel="noreferrer noopener">source</a></>}
                  </li>
                );
              })}
            </ul>
          </aside>

          <footer className="mm-how">
            <span>
              Nemotron Ultra proposed and compared {plans.length || "several"} plans; every number comes from the simulator, not the AI.
            </span>
            <span className="mm-chips">
              <ModelChip tier="ultra" job="analyst" />
              <ModelChip tier="super" job="news reader" />
              <ModelChip tier="fast" job="shoppers" />
            </span>
          </footer>
        </article>
      </div>
    </section>
  );
}

export default MemoScreen;
