"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CrowdArchetype, GridCellData, ShockCase } from "../../lib/events";
import { formatDelta, formatMoney, formatPercent, formatRuns } from "../../lib/format";
import { DO_NOTHING, overCash } from "../../lib/labels";
import { cellKey, reasoningKey, useMarketStore, type PlanRow } from "../../lib/store";
import type { Beat } from "../../lib/timeline";
import { AddPlanPanel } from "../grid/AddPlanPanel";
import { topBubbles } from "../grid/tips";
import { DivBar, maxAbs, sign, tone, useCountUp, useTyped } from "./parts";

const TAG: Record<string, string> = { think: "Thinking", test: "Testing", result: "Result", shoppers: "Shoppers", finish: "Decided", fallback: "Fallback" };

/** What the pacer has put on screen so far. */
export interface Shown {
  steps: Set<number>;
  plans: Set<string>;
  crowd: string[];
  cells: string[];
  done: boolean;
}

export function shownFrom(beats: Beat[], n: number, finished: boolean): Shown {
  const out: Shown = { steps: new Set(), plans: new Set(), crowd: [], cells: [], done: false };
  for (const b of beats.slice(0, n)) {
    if (b.kind === "step") out.steps.add(b.seq);
    else if (b.kind === "plan") out.plans.add(b.name);
    else if (b.kind === "crowd") out.crowd.push(b.plan);
    else out.cells.push(b.key);
  }
  out.done = finished && n >= beats.length;
  return out;
}

// ---- analyst --------------------------------------------------------------------------------------

function Analyst({ shown, active }: { shown: Shown; active: boolean }) {
  const steps = useMarketStore((s) => s.agentSteps);
  const reasoning = useMarketStore((s) => s.reasoningByRound);
  const doneMap = useMarketStore((s) => s.reasoningDone);
  const plans = useMarketStore((s) => s.plans);
  const cells = useMarketStore((s) => s.cells);
  const shocks = useMarketStore((s) => s.shocks);
  const summary = useMarketStore((s) => s.summary);

  const vis = steps.filter((st) => shown.steps.has(st.seq));
  const last = vis[vis.length - 1];
  const round = last?.round ?? 0;
  const key = round === 0 && !reasoning[reasoningKey("analyst", 0)] ? reasoningKey("scenarios", 0) : reasoningKey("analyst", round);
  const raw = reasoning[key] ?? "";
  const typed = useTyped(raw, active);
  const typing = typed.length < raw.length || (!!raw && !doneMap[key]);
  const tail = typed.length > 520 ? "…" + typed.slice(-520) : typed;
  const newsId = shocks.find((s) => s.id === "news")?.id ?? shocks[0]?.id;
  const best = shown.done ? summary?.best_today : null;

  return (
    <div className="fl-card">
      <div className="fl-ch">
        <div>
          <h2>The analyst</h2>
          <p className="fl-sub">Nemotron Ultra proposes plans, reads the results, then tries better ones.</p>
        </div>
        <span className="fl-pill acc">{shown.done ? "Done" : `Round ${round + 1} of 3`}</span>
      </div>
      {raw && (
        <div className={`fl-think${typing && !shown.done ? " fl-caret" : ""}`} aria-label="The analyst's reasoning">
          {tail}
        </div>
      )}
      <ol className="fl-log" aria-live="polite">
        {vis.slice(-5).map((st) => (
          <li key={st.seq} className={`k-${st.kind}`}>
            <span className="tg">{TAG[st.kind] ?? st.kind}</span>
            <span>{st.text}</span>
          </li>
        ))}
        {vis.length === 0 && (
          <li>
            <span className="tg">
              <span className="fl-spin" />
            </span>
            <span className="fl-sub" style={{ margin: 0 }}>
              Reading the news and your numbers…
            </span>
          </li>
        )}
      </ol>
      {shown.plans.size > 0 && (
        <ul className="fl-plans">
          {plans
            .filter((p) => shown.plans.has(p.name))
            .map((p) => {
              const got = shocks.filter((s) => shown.cells.includes(cellKey(p.name, s.id))).length;
              const c = newsId ? cells[cellKey(p.name, newsId)] : undefined;
              const isBest = best === p.name;
              return (
                <li key={p.name} className={isBest ? "best" : ""}>
                  <span className="r">{p.source === "user" ? "You" : `R${p.round + 1}`}</span>
                  <span className="nm">{p.name}</span>
                  <span className="st">
                    {got === 0 ? (
                      "waiting"
                    ) : got < shocks.length ? (
                      <>
                        <span className="fl-spin" /> testing
                      </>
                    ) : c ? (
                      <span className={sign(c.mean_delta_usd)}>{formatDelta(c.mean_delta_usd)}</span>
                    ) : (
                      "tested"
                    )}
                    {isBest && <span className="fl-pill acc">★ Best</span>}
                  </span>
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}

// ---- shoppers -------------------------------------------------------------------------------------

function Shoppers({ shown }: { shown: Shown }) {
  const crowd = useMarketStore((s) => s.crowdByPlan);
  const plan = shown.crowd[shown.crowd.length - 1];
  const arch: CrowdArchetype[] = plan ? (crowd[plan] ?? []) : [];
  const toYou = arch.filter((a) => a.mu[0] > 0.02).length;
  const away = arch.filter((a) => a.mu[0] < -0.02).length;
  return (
    <div className="fl-card">
      <div className="fl-ch">
        <div>
          <h2>The shoppers</h2>
          <p className="fl-sub">{plan ? <>{arch.length} kinds of customer react to “{plan}”</> : "Each kind of customer is played by Nemotron Lightning."}</p>
        </div>
        <span className="fl-pill" style={{ color: "#4b7500" }}>
          Lightning
        </span>
      </div>
      <div className="fl-tiles" key={plan ?? "none"}>
        {(arch.length ? arch : Array.from({ length: 12 }, () => null)).map((a, i) =>
          a ? (
            <div
              key={a.id}
              className={`fl-tile pop${a.mu[0] > 0.02 ? " up" : a.mu[0] < -0.02 ? " down" : ""}`}
              style={{ ["--i" as string]: i }}
              title={`${a.label}: “${a.bubble}”`}
            >
              <span className="e" aria-hidden>
                {a.mu[0] > 0.02 ? "↑" : a.mu[0] < -0.02 ? "↓" : "·"}
              </span>
              {a.label}
            </div>
          ) : (
            <div key={i} className="fl-tile" aria-hidden />
          ),
        )}
      </div>
      {arch.length > 0 ? (
        <>
          <p className="fl-sub" style={{ marginTop: 10 }}>
            <b className="pos">{toYou}</b> lean to you · <b className="neg">{away}</b> lean away · {arch.length - toYou - away} don&apos;t mind
          </p>
          <div className="fl-bubs">
            {topBubbles(arch).map((a) => (
              <div key={a.id} className="fl-bub">
                <b>{a.label}:</b> “{a.bubble}”
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="fl-sub" style={{ marginTop: 10 }}>
          Asked only about plans that change what customers see, like the price.
        </p>
      )}
    </div>
  );
}

// ---- simulator ------------------------------------------------------------------------------------

/** The spread of one box's runs, drawn as a bell from its average and its 1-in-20 bad case. */
function Bell({ cell }: { cell: GridCellData }) {
  const W = 300,
    H = 120;
  const m = cell.mean_delta_usd;
  const sd = Math.max(Math.abs(m - cell.p5_delta_usd) / 1.645, Math.abs(m) * 0.15, 50);
  const lo = Math.min(m - 3.2 * sd, -sd * 0.5),
    hi = Math.max(m + 3.2 * sd, sd * 0.5);
  const X = (v: number) => ((v - lo) / (hi - lo)) * W;
  const pdf = (v: number) => Math.exp(-0.5 * ((v - m) / sd) ** 2);
  const pts: [number, number][] = [];
  for (let i = 0; i <= 60; i++) {
    const v = lo + ((hi - lo) * i) / 60;
    pts.push([X(v), H - 8 - pdf(v) * (H - 22)]);
  }
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${W} ${H - 8} L0 ${H - 8} Z`;
  const z = X(0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Spread of ${formatRuns(cell.n)} runs`}>
      <defs>
        <clipPath id="fl-neg">
          <rect x="0" y="0" width={Math.max(0, z)} height={H} />
        </clipPath>
        <clipPath id="fl-pos">
          <rect x={Math.max(0, z)} y="0" width={W} height={H} />
        </clipPath>
      </defs>
      <path d={area} fill="var(--fl-loss-bar)" opacity="0.22" clipPath="url(#fl-neg)" />
      <path d={area} fill="var(--fl-gain-bar)" opacity="0.22" clipPath="url(#fl-pos)" />
      <path className="curve" d={line} fill="none" stroke="var(--fl-ink-2)" strokeWidth="1.6" />
      <line x1={z} x2={z} y1="6" y2={H - 8} stroke="var(--fl-ink-3)" strokeDasharray="3 3" />
      <text x={z + 4} y="14" fontSize="10" fill="var(--fl-ink-3)">
        same as doing nothing
      </text>
      <line x1={X(cell.p5_delta_usd)} x2={X(cell.p5_delta_usd)} y1="30" y2={H - 8} stroke="var(--fl-loss)" strokeWidth="1.4" />
      <line x1={X(m)} x2={X(m)} y1="18" y2={H - 8} stroke="var(--fl-accent)" strokeWidth="2" />
      <line x1="0" x2={W} y1={H - 8} y2={H - 8} stroke="var(--fl-line-2)" />
    </svg>
  );
}

function Simulator({ shown }: { shown: Shown }) {
  const cells = useMarketStore((s) => s.cells);
  const shocks = useMarketStore((s) => s.shocks);
  const key = shown.cells[shown.cells.length - 1];
  const cell = key ? cells[key] : undefined;
  const runs = shown.cells.reduce((n, k) => n + (cells[k]?.n ?? 0), 0);
  const counted = useCountUp(runs, 500);
  const shock = cell ? shocks.find((s) => s.id === cell.shock_id) : undefined;
  return (
    <div className="fl-card fl-sim">
      <div className="fl-ch">
        <div>
          <h2>The simulator</h2>
          <p className="fl-sub">{cell ? <>{cell.plan_name} · {shock?.label}</> : "Every plan, in every future, 1,000 times."}</p>
        </div>
        <span className="fl-pill">{formatRuns(Math.round(counted))} runs</span>
      </div>
      {cell ? (
        <>
          <Bell cell={cell} />
          <div className="fl-simn">
            <span>
              Average <b className={sign(cell.mean_delta_usd)}>{formatDelta(cell.mean_delta_usd)}</b>
            </span>
            <span>better in {formatPercent(cell.p_better, 0)} of runs</span>
          </div>
          <p className="fl-sub" style={{ marginTop: 4 }}>
            <span style={{ color: "var(--fl-loss)" }}>Red line:</span> 1 run in 20 is worse than {formatDelta(cell.p5_delta_usd)}. The engine computes every number; the AI never does.
          </p>
        </>
      ) : (
        <div style={{ display: "grid", gap: 8, marginTop: 6 }} aria-hidden>
          <span className="fl-skel" style={{ height: 90 }} />
          <span className="fl-skel" style={{ width: "60%" }} />
        </div>
      )}
    </div>
  );
}

// ---- hover card -----------------------------------------------------------------------------------

interface Hover {
  plan: string;
  shock: string;
  x: number;
  y: number;
  origin: "left" | "right";
}

function TipBody({ cell, shock, rival, cash }: { cell: GridCellData; shock: ShockCase; rival: string; cash: number }) {
  const b = cell.bridge;
  const lines: [string, number][] = [
    ["Cheaper stock", b.cost_usd],
    ["Your price change", b.price_usd],
    ["Customers won/lost", b.volume_usd],
    ["Marketing", b.marketing_usd],
    ["Storage & money tied up", b.holding_usd],
  ];
  const max = Math.max(...lines.map(([, v]) => Math.abs(v)), Math.abs(cell.mean_delta_usd), 1);
  const steady = cell.steady_rival_delta_usd;
  const extra = steady == null ? null : cell.mean_delta_usd - steady;
  const tot = steady == null || extra == null ? 0 : Math.abs(steady) + Math.abs(extra);
  const over = overCash(cell, cash);
  return (
    <>
      <p className="t1">
        <b>{cell.plan_name}</b> · {shock.label}
      </p>
      <p className={`v ${sign(cell.mean_delta_usd)}`} key={cellKey(cell.plan_name, cell.shock_id)}>
        {formatDelta(cell.mean_delta_usd)}
      </p>
      <p className="tx">
        Average over {formatRuns(cell.n)} runs vs doing nothing. In 1 run out of 20 it&apos;s worse than <b>{formatDelta(cell.p5_delta_usd)}</b>. Better in{" "}
        {formatPercent(cell.p_better, 0)} of runs.
      </p>
      <div className="sec">
        {lines
          .filter(([label, v]) => label !== "Marketing" || Math.round(v) !== 0)
          .map(([label, v]) => (
            <div className="br" key={label}>
              <span>{label}</span>
              <DivBar v={v} max={max} />
              <b className={sign(v)}>{formatDelta(v)}</b>
            </div>
          ))}
        <div className="br tot">
          <span>Total</span>
          <DivBar v={cell.mean_delta_usd} max={max} />
          <b className={sign(cell.mean_delta_usd)}>{formatDelta(cell.mean_delta_usd)}</b>
        </div>
      </div>
      {steady != null && extra != null && (
        <div className="sec">
          <div className="fl-sl" aria-hidden>
            <i className="a" style={{ width: tot > 0 ? `${(Math.abs(steady) / tot) * 100}%` : "100%" }} />
            <i className="b" style={{ width: tot > 0 ? `${(Math.abs(extra) / tot) * 100}%` : "0%" }} />
          </div>
          <div className="fl-sk">
            <i className="a" />
            <span>With a rival who never runs out</span>
            <b className={sign(steady)}>{formatDelta(steady)}</b>
          </div>
          <div className="fl-sk">
            <i className="b" />
            <span>Extra if {rival || "the rival"} runs short</span>
            <b className={sign(extra)}>{formatDelta(extra)}</b>
          </div>
        </div>
      )}
      <p className="cash">
        {cell.peak_cash_usd > 0 ? (
          <>
            Cash tied up <b>{formatMoney(cell.peak_cash_usd)}</b>
            {cell.payback_week != null ? ` · back by week ${cell.payback_week + 1}` : " · not back within 24 weeks"}
          </>
        ) : (
          "No extra cash needed · the change pays as you go"
        )}
        {over && <span className="w"> · more than the {formatMoney(cash)} you have</span>}
      </p>
    </>
  );
}

function HoverCard({ hover, on, onHeight }: { hover: Hover | null; on: boolean; onHeight: (h: number) => void }) {
  const cells = useMarketStore((s) => s.cells);
  const shocks = useMarketStore((s) => s.shocks);
  const p = useMarketStore((s) => s.profile);
  const ref = useRef<HTMLDivElement>(null);
  const cell = hover ? cells[cellKey(hover.plan, hover.shock)] : undefined;
  const shock = hover ? shocks.find((s) => s.id === hover.shock) : undefined;
  // the card's height depends on its content: report it so the grid can keep the card on screen
  useLayoutEffect(() => {
    if (ref.current) onHeight(ref.current.offsetHeight);
  });
  if (!hover || typeof document === "undefined") return null;
  const good = (cell?.mean_delta_usd ?? 0) >= 0;
  const glow = `radial-gradient(120% 60% at 0% 0%, color-mix(in srgb, ${good ? "var(--fl-gain-bar)" : "var(--fl-loss-bar)"} 16%, transparent), transparent 70%)`;
  // portalled to <body>: a transformed or filtered ancestor would make `position: fixed` relative to it
  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      id="fl-tip"
      className={`fl-tip${on && cell ? "" : " off"}`}
      style={{ left: hover.x, top: hover.y, ["--ox" as string]: hover.origin }}
    >
      <div className="glow" style={{ background: glow }} />
      <div className="in">{cell && shock && <TipBody cell={cell} shock={shock} rival={p?.rival_name ?? ""} cash={p?.cash_available ?? 0} />}</div>
    </div>,
    document.body,
  );
}

// ---- grid -----------------------------------------------------------------------------------------

function Grid({ shown, scroller }: { shown: Shown; scroller: HTMLElement | null }) {
  const plans = useMarketStore((s) => s.plans);
  const shocks = useMarketStore((s) => s.shocks);
  const cells = useMarketStore((s) => s.cells);
  const news = useMarketStore((s) => s.news);
  const summary = useMarketStore((s) => s.summary);
  const p = useMarketStore((s) => s.profile);
  const openReplay = useMarketStore((s) => s.openReplay);
  const [hover, setHover] = useState<Hover | null>(null);
  const [on, setOn] = useState(false);
  const [adding, setAdding] = useState(false);
  const anchor = useRef<DOMRect | null>(null);
  const tipH = useRef(420);
  const hideT = useRef<number>();

  const rows: PlanRow[] = plans.filter((x) => shown.plans.has(x.name));
  const visible = new Set(shown.cells);
  const max = maxAbs(shown.cells.map((k) => cells[k]).filter(Boolean));
  const best = shown.done ? summary?.best_today : null;
  const safest = shown.done ? summary?.safest : null;
  const cash = p?.cash_available ?? 0;

  const top = useCallback((r: DOMRect) => {
    const h = tipH.current,
      vh = window.innerHeight;
    return Math.round(Math.max(12, Math.min(vh - h - 12, r.top + r.height / 2 - h / 2)));
  }, []);

  const show = (plan: string, shock: string, el: HTMLElement) => {
    window.clearTimeout(hideT.current);
    const r = el.getBoundingClientRect();
    const W = 360,
      vw = window.innerWidth;
    const right = r.right + 14 + W < vw - 12;
    anchor.current = r;
    setHover({ plan, shock, x: right ? r.right + 14 : Math.max(12, r.left - 14 - W), y: top(r), origin: right ? "left" : "right" });
    setOn(true);
  };
  const hide = (delay = 140) => {
    window.clearTimeout(hideT.current);
    hideT.current = window.setTimeout(() => setOn(false), delay);
  };
  // re-clamp once the real height of the new content is known
  const onHeight = useCallback(
    (h: number) => {
      tipH.current = h;
      if (!anchor.current) return;
      const y = top(anchor.current);
      setHover((hv) => (hv && Math.abs(hv.y - y) > 1 ? { ...hv, y } : hv));
    },
    [top],
  );
  useEffect(() => {
    if (!scroller) return;
    const off = () => hide(0);
    scroller.addEventListener("scroll", off, { passive: true });
    return () => scroller.removeEventListener("scroll", off);
  }, [scroller]);
  useEffect(() => () => window.clearTimeout(hideT.current), []);

  const srcNames = (c: ShockCase) =>
    c.source_ids.map((id) => news.find((n) => n.id === id)?.source).filter((x): x is string => !!x);

  return (
    <div className="fl-card">
      <div className="fl-ch">
        <div>
          <h2>Every plan in every future</h2>
          <p className="fl-sub">Profit compared with doing nothing, over 6 months. Hover a box to see where the money comes from; click it to watch one run.</p>
        </div>
        <button type="button" className="fl-btn2" onClick={() => setAdding((a) => !a)} disabled={!p} aria-expanded={adding}>
          {adding ? "Close" : "+ Test your own plan"}
        </button>
      </div>
      {adding && p && (
        <div className="fl-add">
          <AddPlanPanel profile={p} onClose={() => setAdding(false)} />
        </div>
      )}
      <div className="fl-gridw">
        <table className="fl-grid">
          <thead>
            <tr>
              <th scope="col">
                <span className="fl-sub" style={{ margin: 0 }}>
                  Plan
                </span>
              </th>
              {shocks.map((c) => (
                <th key={c.id} scope="col">
                  <b>{c.label}</b>
                  {srcNames(c).map((s) => (
                    <span key={s} className="fl-pill tav" style={{ marginRight: 4 }}>
                      {s}
                    </span>
                  ))}
                  {srcNames(c).length === 0 && <span className="fl-pill">{c.origin === "ai" ? "Nemotron's pick" : "Standard test"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">
                {DO_NOTHING}
                <small>the yardstick</small>
              </th>
              {shocks.map((c) => (
                <td key={c.id} className="fl-cell base">
                  <span className="v">{summary?.baseline_profit_usd[c.id] != null ? formatMoney(summary.baseline_profit_usd[c.id]) : "—"}</span>
                  <span className="b">profit if nothing changes</span>
                </td>
              ))}
            </tr>
            {rows.map((r) => (
              <tr key={r.name} className="fl-in">
                <th scope="row">
                  {best === r.name && <span className="star">★ </span>}
                  {r.name}
                  <small>
                    {r.source === "user" ? "your plan" : r.source === "seed" ? "starter plan" : `Nemotron · round ${r.round + 1}`}
                    {best === r.name && " · best today"}
                    {safest === r.name && " · safest"}
                  </small>
                </th>
                {shocks.map((c) => {
                  const k = cellKey(r.name, c.id);
                  const cell = visible.has(k) ? cells[k] : undefined;
                  if (!cell) return <td key={c.id} className="fl-cell pend" aria-label="Testing" />;
                  const isHov = on && hover?.plan === r.name && hover.shock === c.id;
                  return (
                    <td
                      key={c.id}
                      className={`fl-cell ready ${tone(cell.mean_delta_usd, max)}${isHov ? " hov" : ""}`}
                      tabIndex={0}
                      aria-describedby={isHov ? "fl-tip" : undefined}
                      onMouseEnter={(e) => show(r.name, c.id, e.currentTarget)}
                      onMouseLeave={() => hide()}
                      onFocus={(e) => show(r.name, c.id, e.currentTarget)}
                      onBlur={() => hide()}
                      onClick={() => void openReplay(r.name, c.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          void openReplay(r.name, c.id);
                        }
                      }}
                    >
                      {overCash(cell, cash) && <span className="over" title="Needs more cash than you have">cash!</span>}
                      <span className="v">{formatDelta(cell.mean_delta_usd)}</span>
                      <span className="b">bad case {formatDelta(cell.p5_delta_usd)}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="fl-gfoot">
        <span>Bad case = 1 run in 20 is worse. Green beats doing nothing, red loses to it.</span>
        <span>{formatRuns(shown.cells.reduce((n, k) => n + (cells[k]?.n ?? 0), 0))} runs so far</span>
      </div>
      <HoverCard hover={hover} on={on} onHeight={onHeight} />
    </div>
  );
}

export function StageTest({ shown, active, scroller }: { shown: Shown; active: boolean; scroller: HTMLElement | null }) {
  const shocksReady = useMarketStore((s) => s.shocks.length > 0);
  return (
    <div className="fl-stage">
      <div className="fl-g3">
        <Analyst shown={shown} active={active} />
        <Shoppers shown={shown} />
        <Simulator shown={shown} />
      </div>
      {shocksReady && (
        <div style={{ marginTop: 14 }}>
          <Grid shown={shown} scroller={scroller} />
        </div>
      )}
    </div>
  );
}
