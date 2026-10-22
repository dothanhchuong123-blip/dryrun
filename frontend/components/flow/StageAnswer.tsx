"use client";

import { useState } from "react";
import type { MemoEventData } from "../../lib/events";
import { formatDelta, formatMoney, formatRuns } from "../../lib/format";
import { cellKey, useMarketStore } from "../../lib/store";
import { cellMeter, futureTitle, gridMax } from "../../lib/gridmarks";
import { BlockMeter, FutureHead } from "../faces/GridMarks";
import { CellMath } from "../memo/CellMath";
import { describePlan } from "../memo/MemoScreen";
import "../memo/answer.css";
import { MemoTwins } from "../replay/MemoTwins";
import { BacktestReveal } from "./BacktestReveal";
import { FallbackNotice } from "./FallbackNotice";
import { EngineOnly, sign } from "./parts";

/** Optional review fields (EVENTS v2.1) that lib/events.ts doesn't carry yet. */
type MemoView = MemoEventData & {
  actions?: { week: number; text: string }[];
  runner_up?: { name: string; mean_delta_usd: number; p5_delta_usd: number; why_not: string } | null;
};

const sentences = (t: string | undefined | null): string[] =>
  (t ?? "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

const weekLabel = (w: number) => (w <= 0 ? "This week" : `Week ${w}`);

export function StageAnswer({ onRestart }: { onRestart: () => void }) {
  const memoRaw = useMarketStore((s) => s.memo);
  const plans = useMarketStore((s) => s.plans);
  const shocks = useMarketStore((s) => s.shocks);
  const cells = useMarketStore((s) => s.cells);
  const telemetry = useMarketStore((s) => s.telemetry);
  const profile = useMarketStore((s) => s.profile);
  const downloadMemo = useMarketStore((s) => s.downloadMemo);
  const openReplay = useMarketStore((s) => s.openReplay);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<{ plan: string; shock: string } | null>(null);
  if (!memoRaw) return null;

  const memo = memoRaw as MemoView;
  const n = memo.numbers;
  const plan = plans.find((p) => p.name === memo.plan_name);
  const planText = plan ? describePlan(plan.spec) : memo.plan_name;
  const rival = profile?.rival_name || "your rival";

  // Confidence from the engine's own win rate and bad case.
  const conf =
    n.p_better >= 0.8 && n.p5_delta_usd >= 0 ? { cls: "hi", text: "High confidence" } : n.p_better >= 0.6 ? { cls: "mid", text: "Moderate confidence" } : { cls: "lo", text: "Higher risk" };

  // Weeks to act: the last step in the checklist, else the plan's own start weeks.
  const lastWeek = memo.actions?.length ? Math.max(...memo.actions.map((a) => a.week)) : plan ? Math.max(plan.spec.stock_week, plan.spec.price_change_week) : null;

  const why = sentences(memo.why).slice(0, 4);
  const risks = [...sentences(memo.watch_out)];
  const recheck = sentences(memo.recheck_when);
  const notIn = [...memo.not_modelled.fixed, ...memo.not_modelled.found.map((f) => f.text)];
  const sources = memo.sources.filter((s) => s.title);
  const steady = n.steady_rival_delta_usd;

  // Comparison: the recommended plan and up to two others, across the futures we tested.
  const futures = shocks.filter((s) => cells[cellKey(memo.plan_name, s.id)]);
  const avg = (name: string) => {
    const xs = futures.map((s) => cells[cellKey(name, s.id)]?.mean_delta_usd).filter((v): v is number => v != null);
    return xs.length === futures.length && xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  const others = plans
    .filter((p) => p.name !== memo.plan_name)
    .map((p) => ({ name: p.name, a: avg(p.name) }))
    .filter((x): x is { name: string; a: number } => x.a != null)
    .sort((a, b) => b.a - a.a)
    .slice(0, 2)
    .map((x) => x.name);
  const gmax = gridMax(Object.values(cells).map((c) => c.mean_delta_usd));
  const rows = futures.length ? [memo.plan_name, ...others] : [];

  const asText = () => {
    const L: string[] = [memo.headline, "", `Expected gain vs doing nothing: ${formatDelta(n.mean_delta_usd)} over 6 months`,
      ...(n.engine_only_delta_usd == null ? [] : [`Without the shoppers' reactions (simulator alone): ${formatDelta(n.engine_only_delta_usd)}`]),
      `Bad case (1 run in 20): ${formatDelta(n.p5_delta_usd)}`];
    if (n.peak_cash_usd > 0) L.push(`Cash tied up: ${formatMoney(n.peak_cash_usd)}`);
    L.push("", `PLAN: ${planText}`);
    if (why.length) L.push("", "WHY THIS PLAN", ...why.map((w) => `- ${w}`));
    if (memo.actions?.length) L.push("", "WHAT TO DO", ...memo.actions.map((a, i) => `${i + 1}. [${weekLabel(a.week)}] ${a.text}`));
    if (risks.length || recheck.length) L.push("", "RISKS AND WHAT WOULD CHANGE THE ANSWER", ...[...risks, ...recheck].map((r) => `- ${r}`));
    if (notIn.length) L.push("", "NOT MODELLED", ...notIn.map((t) => `- ${t}`));
    if (sources.length) L.push("", "SOURCES", ...sources.map((s) => `- ${s.title} ${s.url}`));
    return L.join("\n");
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText());
      setNote("Copied");
    } catch {
      setNote("Copy was blocked here");
    }
    setTimeout(() => setNote(null), 2200);
  };

  const calls = telemetry ? telemetry.tiers.ultra.calls + telemetry.tiers.super.calls + telemetry.tiers.fast.calls : 0;

  return (
    <div className="fl-stage am">
      <FallbackNotice />
      <article className="am-paper" aria-labelledby="am-h">
        <header className="am-head">
          <div className="am-eyebrow">
            <span>Decision memo{profile?.business_name ? ` · ${profile.business_name}` : ""}</span>
            <span className={`am-badge ${conf.cls}`}>{conf.text}</span>
            <span className="am-badge plain">
              {formatRuns(n.n)} runs{n.verified ? " · checked on Nebius" : ""}
            </span>
          </div>
          <h1 id="am-h">{memo.headline}</h1>
          <div className="am-big">
            <b className={sign(n.mean_delta_usd)}>{formatDelta(n.mean_delta_usd)}</b>
            <span>expected profit vs doing nothing, over 6 months</span>
            <EngineOnly v={n.engine_only_delta_usd} long />
          </div>
        </header>

        <div className="am-kpis">
          <div className="am-kpi">
            <small>Profit change</small>
            <b className={sign(n.mean_delta_usd)}>{formatDelta(n.mean_delta_usd)}</b>
            <span>{Math.round(n.p_better * 100)}% of runs beat doing nothing</span>
            <EngineOnly v={n.engine_only_delta_usd} />
          </div>
          <div className="am-kpi">
            <small>Bad case</small>
            <b className={sign(n.p5_delta_usd)}>{formatDelta(n.p5_delta_usd)}</b>
            <span>{n.p5_delta_usd >= 0 ? "still ahead" : "behind"} in the worst 1 run in 20</span>
          </div>
          <div className="am-kpi">
            <small>Cash tied up</small>
            <b>{n.peak_cash_usd > 0 ? formatMoney(n.peak_cash_usd) : "None"}</b>
            <span>
              {n.peak_cash_usd > 0
                ? `${n.over_cash && n.cash_available > 0 ? `over the ${formatMoney(n.cash_available)} you have` : n.cash_available > 0 ? `of ${formatMoney(n.cash_available)} you have` : "up front"}${n.payback_week != null ? `, back by week ${n.payback_week + 1}` : ""}`
                : "no extra cash needed"}
            </span>
          </div>
          {lastWeek != null && (
            <div className="am-kpi">
              <small>Time to act</small>
              <b>{lastWeek <= 0 ? "This week" : `${lastWeek} ${lastWeek === 1 ? "week" : "weeks"}`}</b>
              <span>{lastWeek <= 0 ? "everything starts now" : "until the last step is in place"}</span>
            </div>
          )}
        </div>

        <MemoTwins planName={memo.plan_name} shockId={n.shock_id} onFull={() => void openReplay(memo.plan_name, n.shock_id)} />

        <section className="am-sec" aria-label="The plan">
          <h2>The plan</h2>
          <p style={{ margin: 0, fontSize: 17, lineHeight: 1.45, color: "var(--fl-ink)", fontWeight: 550 }}>{planText}</p>
        </section>

        {rows.length > 0 && (
          <section className="am-sec" aria-label="Plans compared">
            <h2>How it compares</h2>
            <p className="am-sub">Profit change vs doing nothing in each future we tested. Tap a number to see how it was computed.</p>
            <div className="am-tbl-wrap">
              <table className="am-tbl">
                <thead>
                  <tr>
                    <th scope="col">Plan</th>
                    {futures.map((s) => (
                      <th scope="col" key={s.id} title={futureTitle(s)}>
                        <FutureHead shock={s} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r} className={i === 0 ? "rec" : undefined}>
                      <td>
                        {r}
                        {i === 0 && <span className="tag">Recommended</span>}
                      </td>
                      {futures.map((s) => {
                        const v = cells[cellKey(r, s.id)]?.mean_delta_usd;
                        const eng = cells[cellKey(r, s.id)]?.engine_only_delta_usd;
                        if (v == null) return <td key={s.id}>n/a</td>;
                        const on = open?.plan === r && open.shock === s.id;
                        return (
                          <td key={s.id} className={`c ${sign(v)}${on ? " on" : ""}`}>
                            <button type="button" className="am-cellbtn" aria-expanded={on} onClick={() => setOpen(on ? null : { plan: r, shock: s.id })}>
                              <BlockMeter meter={cellMeter(v, gmax)} />
                              <span className="am-num">
                                {formatDelta(v)}
                                <EngineOnly v={eng} />
                              </span>
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="base">
                    <td>Do nothing</td>
                    {futures.map((s) => (
                      <td key={s.id}>{formatDelta(0)}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            {(() => {
              const c = open && cells[cellKey(open.plan, open.shock)];
              const sh = open && shocks.find((x) => x.id === open.shock);
              return c && sh ? <CellMath cell={c} shock={sh} profile={profile} onClose={() => setOpen(null)} /> : null;
            })()}
            {steady != null && (
              <p className="am-luck">
                <b>Skill vs luck.</b> Even if {rival} never runs out of stock, this plan makes <b>{formatDelta(steady)}</b>. The other <b>{formatDelta(n.mean_delta_usd - steady)}</b> only comes if they run short.
              </p>
            )}
          </section>
        )}

        {why.length > 0 && (
          <section className="am-sec" aria-label="Why this plan">
            <h2>Why this plan</h2>
            <ul className="am-bul">
              {why.map((w) => (
                <li key={w}>{w}</li>
              ))}
              {memo.runner_up && (
                <li>
                  Over {memo.runner_up.name}: {memo.runner_up.why_not}
                </li>
              )}
            </ul>
          </section>
        )}

        {memo.actions && memo.actions.length > 0 && (
          <section className="am-sec" aria-label="Action steps">
            <h2>What to do</h2>
            <ol className="am-steps">
              {memo.actions.map((a, i) => (
                <li key={i}>
                  <span className="am-box" aria-hidden />
                  <span className="am-wk">{weekLabel(a.week)}</span>
                  <span>{a.text}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {(risks.length > 0 || recheck.length > 0) && (
          <section className="am-sec" aria-label="Risks">
            <div className="am-twocol">
              {risks.length > 0 && (
                <div>
                  <h2>Risks</h2>
                  <ul className="am-bul warn">
                    {risks.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
              {recheck.length > 0 && (
                <div>
                  <h2>What would change the answer</h2>
                  <ul className="am-bul">
                    {recheck.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        )}

        {sources.length > 0 && (
          <section className="am-sec" aria-label="Sources">
            <h2>Sources</h2>
            <ul className="am-src">
              {sources.map((s) => (
                <li key={s.url + s.title}>
                  {/^https?:\/\//.test(s.url) ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      {s.title}
                    </a>
                  ) : (
                    s.title
                  )}
                  {s.quote && <q>{s.quote}</q>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {notIn.length > 0 && (
          <details className="am-fold">
            <summary>What isn&apos;t modelled ({notIn.length})</summary>
            <ul className="am-bul warn">
              {notIn.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </details>
        )}

        <footer className="am-foot">
          Plans by NVIDIA Nemotron; every number comes from our simulator, never from the AI.
          {memo.cost_line ? ` How the news moved your cost: ${memo.cost_line}.` : ""}
          {calls > 0 && telemetry ? ` ${calls} AI calls, $${telemetry.cost_usd.toFixed(2)}.` : ""}
        </footer>
      </article>

      <BacktestReveal />

      <div className="am-bar">
        <button type="button" className="fl-btn2" onClick={() => void openReplay(memo.plan_name, n.shock_id)}>
          ▶ Watch one run
        </button>
        <button type="button" className="fl-btn2" onClick={() => void copy()}>
          Copy as text
        </button>
        <button type="button" className="fl-btn2" onClick={() => window.print()}>
          Print
        </button>
        <button type="button" className="fl-btn2" onClick={() => void downloadMemo()}>
          Download .md
        </button>
        <button type="button" className="fl-btn" onClick={onRestart}>
          Test another business
        </button>
        {note && (
          <span className="am-toast" role="status">
            {note}
          </span>
        )}
      </div>
    </div>
  );
}
