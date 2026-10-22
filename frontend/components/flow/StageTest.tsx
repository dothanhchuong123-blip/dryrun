"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CrowdArchetype, GridCellData, ShockCase } from "../../lib/events";
import { formatDelta, formatMoney, formatPercent, formatRuns } from "../../lib/format";
import { DO_NOTHING, overCash } from "../../lib/labels";
import { cellKey, reasoningKey, useMarketStore, type PlanRow } from "../../lib/store";
import type { Beat } from "../../lib/timeline";
import { leanOf, moodOf, shopperOf, traitLine } from "../../lib/faces";
import { mixOf, shareOf } from "../../lib/mix";
import { PixelFace } from "../faces/PixelFace";
import { AddPlanPanel } from "../grid/AddPlanPanel";
import { topBubbles } from "../grid/tips";
import { DivBar, EngineOnly, maxAbs, sign, tone, useCountUp, useHeld, useTyped } from "./parts";

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
                      <>
                        <span className={sign(c.mean_delta_usd)}>{formatDelta(c.mean_delta_usd)}</span>
                        <EngineOnly v={c.engine_only_delta_usd} />
                      </>
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

// before the first plan: the same 12 customers, waiting with flat faces
const WAITING: CrowdArchetype[] = Array.from({ length: 12 }, (_, id) => ({ id, label: "", mu: [0, 0], sigma: [0, 0], bubble: "" }));

function Shoppers({ shown }: { shown: Shown }) {
  const crowd = useMarketStore((s) => s.crowdByPlan);
  const plan = useHeld(shown.crowd[shown.crowd.length - 1], 1800);
  const arch: CrowdArchetype[] = plan ? (crowd[plan] ?? []) : [];
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => setSel(null), [plan]);
  const mix = mixOf(useMarketStore((s) => s.profile));
  const pct = (a: CrowdArchetype) => shareOf(shopperOf(a), mix);
  const toYou = arch.filter((a) => leanOf(a) > 0).length;
  const away = arch.filter((a) => leanOf(a) < 0).length;
  const same = arch.length - toYou - away;
  // the bar is weighted by the customer mix: how many BUYERS lean each way, not how many kinds
  const wSum = arch.reduce((t, a) => t + pct(a), 0) || 1;
  const wYou = arch.filter((a) => leanOf(a) > 0).reduce((t, a) => t + pct(a), 0) / wSum;
  const wAway = arch.filter((a) => leanOf(a) < 0).reduce((t, a) => t + pct(a), 0) / wSum;
  const wSame = Math.max(0, 1 - wYou - wAway);
  const asPct = (x: number) => `${Math.round(100 * x)}%`;
  const picked = arch.find((a) => a.id === sel);
  const said = (picked ? [picked] : topBubbles(arch)).filter((a) => a.bubble.trim());
  const disc = (a: CrowdArchetype) => (leanOf(a) > 0 ? "var(--px-you-soft)" : leanOf(a) < 0 ? "var(--px-rival-soft)" : "var(--px-none-soft)");
  return (
    <div className="fl-card ts-shop">
      <div className="fl-ch">
        <div>
          <h2>How your customers feel about it</h2>
          <p className="fl-sub">
            {plan ? (
              <>
                <b className="ts-n">{arch.length} kinds of customer</b> react to “{plan}”. Tap a face to hear them.
              </>
            ) : (
              "Each kind of customer is played by Nemotron Lightning. Their faces change with every plan."
            )}
          </p>
        </div>
        <span className="fl-pill" style={{ color: "#4b7500" }}>
          Lightning
        </span>
      </div>
      {arch.length > 0 && (
        <div className="ts-sum">
          <div className="ts-bar" role="img" aria-label={`${asPct(wYou)} of buyers lean to you, ${asPct(wSame)} don't mind, ${asPct(wAway)} lean to the rival`}>
            <i className="u" style={{ flexGrow: wYou }} />
            <i className="z" style={{ flexGrow: wSame }} />
            <i className="d" style={{ flexGrow: wAway }} />
          </div>
          <p className="fl-sub" style={{ margin: "6px 0 0" }}>
            <b className="you">{asPct(wYou)}</b> of buyers lean to you ({toYou} kinds) · <b>{asPct(wSame)}</b> don&apos;t mind ({same}) ·{" "}
            <b className="riv">{asPct(wAway)}</b> lean to the rival ({away})
          </p>
        </div>
      )}
      <div className="px-crowd">
        {(arch.length ? arch : WAITING).map((a) => {
          const who = shopperOf(a);
          const l = leanOf(a);
          const waiting = !arch.length;
          return (
            <button
              type="button"
              key={a.id}
              className={`px-p${l > 0 ? " up" : l < 0 ? " down" : ""}${sel === a.id ? " sel" : ""}${waiting ? " wait" : ""}`}
              title={waiting ? undefined : `${who.name}, ${traitLine(who)}: “${a.bubble}”`}
              aria-pressed={sel === a.id}
              disabled={waiting}
              onClick={() => setSel((c) => (c === a.id ? null : a.id))}
            >
              <span className="disc">
                <PixelFace shopper={who} mood={waiting ? 0 : moodOf(a)} bg={waiting ? "var(--px-disc)" : disc(a)} />
                {!waiting && (
                  <span className="lean" aria-hidden>
                    {l > 0 ? "↑" : l < 0 ? "↓" : "·"}
                  </span>
                )}
              </span>
              <span className="nm">{who.name}</span>
              <span className="tr">{waiting ? "waiting for a plan" : `${traitLine(who)} · ${asPct(pct(a))} of buyers`}</span>
            </button>
          );
        })}
      </div>
      {arch.length > 0 ? (
        <>
          {said.length > 0 && (
            <div className="px-said" aria-live="polite">
              {said.map((a) => {
                const who = shopperOf(a);
                return (
                  <div className="px-line" key={`${plan}-${a.id}`}>
                    <span className="who">
                      <PixelFace shopper={who} mood={moodOf(a)} bg={disc(a)} />
                    </span>
                    <span className="tail" aria-hidden />
                    <span className="px-bub">
                      <small>
                        {who.name} · {traitLine(who)}
                      </small>
                      “{a.bubble}”
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <button type="button" className="ts-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? "Hide the list" : `See what all ${arch.length} said`}
            <span aria-hidden>{open ? " ↑" : " ↓"}</span>
          </button>
          {open && (
            <ul className="ts-react">
              {[...arch]
                .sort((x, y) => y.mu[0] - x.mu[0])
                .map((a) => {
                  const who = shopperOf(a);
                  return (
                    <li key={a.id} className={leanOf(a) > 0 ? "up" : leanOf(a) < 0 ? "down" : ""}>
                      <span className="f" aria-hidden>
                        <PixelFace shopper={who} mood={moodOf(a)} bg={disc(a)} />
                      </span>
                      <span>
                        <b>
                          {who.name} <small>· {traitLine(who)}</small>
                        </b>
                        <em>“{a.bubble}”</em>
                      </span>
                    </li>
                  );
                })}
            </ul>
          )}
        </>
      ) : (
        <p className="fl-sub" style={{ marginTop: 10 }}>
          Asked only about plans that change what customers see, like the price.
        </p>
      )}
      <ShopperHistory plans={[...new Set(shown.crowd)].filter((x) => x !== plan).reverse()} crowd={crowd} />
    </div>
  );
}

/** The earlier plans the shoppers reacted to, newest first: how they split and the strongest line. */
function ShopperHistory({ plans, crowd }: { plans: string[]; crowd: Record<string, CrowdArchetype[]> }) {
  const all = plans.filter((p) => (crowd[p]?.length ?? 0) > 0);
  const rows = all.slice(0, 6);
  if (!rows.length) return null;
  return (
    <div className="fl-hist">
      <small>Earlier plans</small>
      <ul>
        {rows.map((p) => {
          const a = crowd[p];
          const up = a.filter((x) => x.mu[0] > 0.02).length;
          const down = a.filter((x) => x.mu[0] < -0.02).length;
          const top = topBubbles(a)[0];
          return (
            <li key={p}>
              <div className="hd">
                <span className="nm">{p}</span>
                <span className="fl-split" aria-label={`${up} lean to you, ${down} lean away`}>
                  <i className="u" style={{ flexGrow: up }} />
                  <i className="z" style={{ flexGrow: a.length - up - down }} />
                  <i className="d" style={{ flexGrow: down }} />
                </span>
              </div>
              {top && (
                <p className="q">
                  <b>{shopperOf(top).name}:</b> “{top.bubble}”
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {all.length > rows.length && <p className="ts-moretx">+ {all.length - rows.length} earlier plans</p>}
    </div>
  );
}

// ---- simulator ------------------------------------------------------------------------------------

/** Inverse error function (Giles' approximation), for spacing the blocks along the spread. */
function erfinv(x: number): number {
  const w = -Math.log((1 - x) * (1 + x));
  let p: number;
  if (w < 5) {
    const t = w - 2.5;
    p = 2.81022636e-8;
    for (const c of [3.43273939e-7, -3.5233877e-6, -4.39150654e-6, 0.00021858087, -0.00125372503, -0.00417768164, 0.246640727, 1.50140941]) p = c + p * t;
  } else {
    const t = Math.sqrt(w) - 3;
    p = -0.000200214257;
    for (const c of [0.000100950558, 0.00134934322, -0.00367342844, 0.00573950773, -0.0076224613, 0.00943887047, 1.00167406, 2.83297682]) p = c + p * t;
  }
  return p * x;
}

const BLOCKS = 40,
  VW = 300; // viewBox width; the height follows the tallest stack

/**
 * The box's runs as a block chart: 40 blocks, each standing for 1/40 of the runs, placed along "profit vs doing
 * nothing" and stacked where outcomes pile up. The blocks are evenly spaced points of the spread implied by
 * the box's average and 1-in-20 bad case. The colour split matches the box's real share of runs that beat doing nothing.
 */
function blocksFor(cell: GridCellData) {
  const m = cell.mean_delta_usd;
  const sd = Math.max((m - cell.p5_delta_usd) / 1.645, Math.abs(m) * 0.08, 30);
  const vals = Array.from({ length: BLOCKS }, (_, i) => m + sd * Math.SQRT2 * erfinv(2 * ((i + 0.5) / BLOCKS) - 1));
  const wins = Math.round(cell.p_better * BLOCKS);
  const lo = Math.min(0, vals[0]),
    hi = Math.max(0, vals[BLOCKS - 1]);
  const span = hi - lo || 1;
  const cols = 16;
  const colOf = (v: number) => Math.min(cols - 1, Math.max(0, Math.floor(((v - lo) / span) * cols)));
  const heights = new Array(cols).fill(0);
  const placed = vals.map((v, i) => {
    const c = colOf(v);
    return { c, r: heights[c]++, win: i >= BLOCKS - wins };
  });
  const top = Math.max(...heights);
  const s = Math.min(VW / cols, 110 / top); // block pitch, so the tallest stack fits
  const x0 = (VW - cols * s) / 2;
  const X = (v: number) => x0 + ((v - lo) / span) * cols * s;
  const base = top * s + 20; // the axis line, under the tallest stack and the "Do nothing" label
  return { placed, s, x0, base, zero: X(0), avg: X(m), lo, hi, wins };
}

function Fan({ cell }: { cell: GridCellData }) {
  const b = blocksFor(cell);
  const BASE = b.base;
  const per = Math.round(cell.n / BLOCKS);
  const z = Math.min(VW - 2, Math.max(2, b.zero));
  const a = Math.min(VW - 30, Math.max(30, b.avg));
  return (
    <div className="fl-fan dots">
      <svg viewBox={`0 0 ${VW} ${BASE + 26}`} role="img" aria-label={`${b.wins} of ${BLOCKS} blocks beat doing nothing; average ${formatDelta(cell.mean_delta_usd)}`} shapeRendering="crispEdges">
        <text x={z + (z > VW - 90 ? -4 : 4)} y={12} className="zl" textAnchor={z > VW - 90 ? "end" : "start"}>
          Do nothing
        </text>
        <line x1={z} x2={z} y1={4} y2={BASE} className="zero" />
        {b.placed.map((p, i) => (
          <rect
            key={i}
            x={b.x0 + p.c * b.s + 0.5}
            y={BASE - (p.r + 1) * b.s + 0.5}
            width={b.s - 1.5}
            height={b.s - 1.5}
            className={p.win ? "w" : "l"}
            style={{ ["--d" as string]: `${i * 22}ms` }} // drop in worst to best, so the chart fills left to right
          />
        ))}
        <line x1={0} x2={VW} y1={BASE} y2={BASE} className="axis" />
        <path d={`M${a - 4} ${BASE + 9}h8l-4 -6z`} className="avg" />
        <text x={a} y={BASE + 22} className="al" textAnchor="middle">
          avg {formatDelta(cell.mean_delta_usd)}
        </text>
        <text x={2} y={BASE + 22} className="ax">
          ← worse
        </text>
        <text x={VW - 2} y={BASE + 22} className="ax" textAnchor="end">
          better →
        </text>
      </svg>
      <p className="fl-fanlg">
        <span>
          <i className="w" /> beat doing nothing
        </span>
        <span>
          <i className="l" /> worse
        </span>
        <span className="per">1 block = {formatRuns(per)} runs</span>
      </p>
    </div>
  );
}

/** Counts this box's runs up from 0 as its lines draw. */
function RunCount({ n }: { n: number }) {
  const v = useCountUp(n, 1100, 0);
  return <b>{formatRuns(Math.round(v))}</b>;
}

function Simulator({ shown }: { shown: Shown }) {
  const cells = useMarketStore((s) => s.cells);
  const shocks = useMarketStore((s) => s.shocks);
  // boxes land every ~130 ms; hold each one long enough to watch its runs draw
  const key = useHeld(shown.cells[shown.cells.length - 1], 1900);
  const cell = key ? cells[key] : undefined;
  const total = shown.cells.reduce((n, k) => n + (cells[k]?.n ?? 0), 0);
  const shock = cell ? shocks.find((s) => s.id === cell.shock_id) : undefined;
  return (
    <div className="fl-card fl-sim">
      <div className="fl-ch">
        <div style={{ minWidth: 0 }}>
          <h2>The simulator</h2>
          <p className="fl-sub">
            {cell ? (
              <>
                <b style={{ color: "var(--fl-ink)", fontWeight: 600 }}>{cell.plan_name}</b> · {shock?.label}
              </>
            ) : (
              "Each plan is simulated 1,000 times in every future, using the same random draws, so the comparison is fair."
            )}
          </p>
        </div>
        <span className="fl-pill">{formatRuns(total)} runs</span>
      </div>
      {cell ? (
        <div key={key}>
          <Fan cell={cell} />
          <div className="fl-simn">
            <span>
              <RunCount n={cell.n} /> / {formatRuns(cell.n)} runs
            </span>
            <span className="res">
              Average <b className={sign(cell.mean_delta_usd)}>{formatDelta(cell.mean_delta_usd)}</b>
            </span>
          </div>
          <EngineOnly v={cell.engine_only_delta_usd} long />
          <p className="fl-sub res" style={{ marginTop: 4 }}>
            Better than doing nothing in {Math.round(cell.p_better * 100)} of 100 runs. 1 in 20 is worse than {formatDelta(cell.p5_delta_usd)}.
          </p>
          <SimHistory keys={shown.cells} current={key} />
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8, marginTop: 6 }} aria-hidden>
          <span className="fl-skel" style={{ height: 150 }} />
          <span className="fl-skel" style={{ width: "60%" }} />
        </div>
      )}
    </div>
  );
}

/** The boxes tested so far, newest first: how often each beat doing nothing, and its average. */
function SimHistory({ keys, current }: { keys: string[]; current?: string }) {
  const cells = useMarketStore((s) => s.cells);
  const shocks = useMarketStore((s) => s.shocks);
  // up to the box on screen, so the list never runs ahead of the fan
  const upTo = current ? keys.indexOf(current) : -1;
  const rows = keys
    .slice(0, upTo + 1)
    .reverse()
    .slice(0, 6)
    .map((k) => cells[k])
    .filter((c): c is GridCellData => !!c);
  if (!rows.length) return null;
  return (
    <div className="fl-hist">
      <small>Tested so far · share of runs that beat doing nothing</small>
      <ul>
        {rows.map((c) => {
          const k = cellKey(c.plan_name, c.shock_id);
          return (
            <li key={k} className={`sim${k === current ? " cur" : ""}`}>
              <span className="nm">
                {c.plan_name}
                <em>{shocks.find((s) => s.id === c.shock_id)?.label ?? c.shock_id}</em>
              </span>
              <span className="fl-win" aria-label={`${Math.round(c.p_better * 100)}% of runs beat doing nothing`}>
                <i style={{ width: `${Math.round(c.p_better * 100)}%` }} />
              </span>
              <b className={sign(c.mean_delta_usd)}>{formatDelta(c.mean_delta_usd)}</b>
            </li>
          );
        })}
      </ul>
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
      <EngineOnly v={cell.engine_only_delta_usd} long />
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ up: false, down: 0, left: false, right: 0 });
  const userAt = useRef(-1e9);
  const autoDone = useRef(false);

  const rows: PlanRow[] = plans.filter((x) => shown.plans.has(x.name));
  const visible = new Set(shown.cells);
  const max = maxAbs(shown.cells.map((k) => cells[k]).filter(Boolean));
  const best = shown.done ? summary?.best_today : null;
  const safest = shown.done ? summary?.safest : null;
  const cash = p?.cash_available ?? 0;
  // the recommended row plays its entrance once, the first time it is on screen after the run is done
  const recRef = useRef<HTMLTableRowElement>(null);
  const [recSeen, setRecSeen] = useState<string | null>(null);
  useEffect(() => {
    const el = recRef.current;
    if (!best || !el || recSeen === best) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        setRecSeen(best);
        io.disconnect();
      },
      { threshold: 0.9 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [best, recSeen]);

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

  // how much of the grid is hidden past each edge: counts whole plans (rows) and futures (columns)
  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const headH = el.querySelector("thead")?.getBoundingClientRect().height ?? 0;
    const headW = el.querySelector("tbody th")?.getBoundingClientRect().width ?? 0;
    const view = el.getBoundingClientRect();
    wrapRef.current?.style.setProperty("--ts-head", `${Math.round(headH)}px`);
    wrapRef.current?.style.setProperty("--ts-col", `${Math.round(headW)}px`);
    let down = 0,
      right = 0;
    el.querySelectorAll("tbody tr").forEach((tr) => {
      if (tr.getBoundingClientRect().top > view.bottom - 12) down++;
    });
    el.querySelectorAll("thead th:not(:first-child)").forEach((th) => {
      if (th.getBoundingClientRect().left > view.right - 12) right++;
    });
    const next = {
      up: el.scrollTop > headH * 0.25,
      left: el.scrollLeft > headW * 0.1,
      down: el.scrollHeight - el.scrollTop - el.clientHeight > 6 ? Math.max(down, 1) : 0,
      right: el.scrollWidth - el.scrollLeft - el.clientWidth > 6 ? Math.max(right, 1) : 0,
    };
    setEdge((e) => (e.up === next.up && e.left === next.left && e.down === next.down && e.right === next.right ? e : next));
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const t = el.querySelector("table");
    if (t) ro.observe(t);
    const off = () => hide(0);
    el.addEventListener("scroll", off, { passive: true });
    return () => {
      el.removeEventListener("scroll", measure);
      el.removeEventListener("scroll", off);
      ro.disconnect();
    };
  }, [measure, shocks.length]);
  useEffect(measure, [measure, rows.length, shown.cells.length, adding]);

  // note when the person last scrolled themselves, so the auto-scroll never fights them
  useEffect(() => {
    const mark = () => {
      userAt.current = performance.now();
    };
    const evs = ["wheel", "touchstart", "touchmove", "keydown", "pointerdown"] as const;
    evs.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    return () => evs.forEach((e) => window.removeEventListener(e, mark));
  }, []);

  // once the grid has finished filling, glide it into view (one time)
  useEffect(() => {
    if (!shown.done || autoDone.current) return;
    const t = window.setTimeout(() => {
      autoDone.current = true;
      const w = wrapRef.current;
      if (!w || performance.now() - userAt.current < 4000) return;
      // aim just under the sticky stepper; show the whole card if it fits, else the grid itself
      const box = scroller?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight, height: window.innerHeight };
      const bar = box.top + (document.querySelector<HTMLElement>(".fl-stepper")?.offsetHeight ?? 0);
      const card = w.closest(".fl-card") ?? w;
      const aim = card.getBoundingClientRect().height + bar + 90 <= box.bottom ? card : w;
      const r = aim.getBoundingClientRect();
      const dy = r.top - Math.max(bar, box.top) - 12;
      // already in place: leave it alone
      if (Math.abs(dy) < 24) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (scroller) scroller.scrollTo({ top: scroller.scrollTop + dy, behavior: reduce ? "auto" : "smooth" });
      else aim.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    }, 500);
    return () => window.clearTimeout(t);
  }, [shown.done, scroller]);

  const nudge = (dx: number, dy: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dx, top: dy, behavior: reduce ? "auto" : "smooth" });
  };

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
      <div className="ts-wrap" ref={wrapRef}>
      <div className="fl-gridw ts-scroll" ref={scrollRef} tabIndex={-1}>
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
              <tr
                key={r.name}
                ref={best === r.name ? recRef : undefined}
                className={best === r.name ? `fl-in fl-rec${recSeen === r.name ? " go" : ""}` : "fl-in"}
              >
                <th scope="row">
                  {best === r.name && <span className="star">★ </span>}
                  {r.name}
                  {best === r.name && <span className="fl-rectag">Recommended</span>}
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
      <span className={`ts-fade b${edge.down ? " on" : ""}`} aria-hidden />
      <span className={`ts-fade r${edge.right ? " on" : ""}`} aria-hidden />
      <span className={`ts-fade t${edge.up ? " on" : ""}`} aria-hidden />
      <span className={`ts-fade l${edge.left ? " on" : ""}`} aria-hidden />
      {edge.down > 0 && (
        <button type="button" className="ts-more-pill down" onClick={() => nudge(0, (scrollRef.current?.clientHeight ?? 300) * 0.8)}>
          {edge.down} more {edge.down === 1 ? "plan" : "plans"} <span aria-hidden>↓</span>
        </button>
      )}
      {edge.right > 0 && (
        <button type="button" className="ts-more-pill right" onClick={() => nudge((scrollRef.current?.clientWidth ?? 300) * 0.7, 0)}>
          {edge.right === 1 ? "1 more future" : `${edge.right} more futures`} <span aria-hidden>→</span>
        </button>
      )}
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
