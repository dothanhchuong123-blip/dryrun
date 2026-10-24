"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ShockCase } from "../../lib/events";
import { reducedMotion } from "../../lib/follow";
import { formatDelta, formatPrice } from "../../lib/format";
import { FutureHead } from "../faces/GridMarks";
import stripLive from "../../mock/strip_live.json";
import stripMock from "../../mock/strip_mock.json";
import "./howitworks.css";

/**
 * The visual "how it works" strip at the bottom of the landing page (DESIGN §12.6): four small screens made from the
 * same recorded runs the example cards play (mock/strip_mock.json offline, strip_live.json with the backend; both are
 * lists cut by scripts/make_strip_data.py), played as one loop. Each loop plays the next run in the list, so the strip
 * never repeats the business it just showed. Each box moves in its
 * own way and hands its result to the next: the typed keywords fly into the news search, the search reel locks on the
 * stories that hit your costs and the first one's shock flies into the simulator, the simulator fans out its runs and
 * collapses them to one number, and that number flies into the memo. One clock (requestAnimationFrame) drives it; the
 * boxes ease with CSS transitions, the simulator draws on a canvas, the hand-offs are Web Animations clones. It plays
 * only while on screen; with reduced motion every box shows its final state and nothing flies. No network, no LLM.
 */

const HOW = [
  { t: "Describe your business", d: "One line is enough, or paste a link. We guess the rest and mark it." },
  { t: "We search the news", d: "Tavily finds this week's news that actually hits your costs and customers." },
  { t: "An AI analyst proposes plans", d: "Nemotron suggests moves; a simulator stress-tests each across possible futures." },
  { t: "You get a decision memo", d: "The plan that holds up best, with the numbers and sources behind it." },
];

/** The whole loop, in ms, box by box. */
const S = {
  typeEnd: 1300, kw: 1380, chips: 1550,
  fly1: 2000,
  scan: 2750, scanEnd: 3250, reel: 2950, lock: 4150, lockGap: 160,
  fly2: 4700,
  sim: 5450, card: 7200,
  fly3: 7550,
  hero: 7650, words: 7750, stamp: 8550, walk: 8800,
  out: 11000, loop: 11500,
};
/** Inside the simulator: runs launch over RUN_SPREAD, each crosses the chart in RUN_CROSS, the fan dims and the average draws after RUN_END. */
const RUN_SPREAD = 1150, RUN_CROSS = 420, RUN_END = 1600, MEAN_DRAW = 320;
const STILL = S.out - 1;
const FLY = 720;
/** Where each box's own part of the loop begins: box 1 at the start, the others when the hand-off to them leaves. */
const W = [0, S.fly1, S.fly2, S.fly3];
const act = (t: number) => (t < 2500 ? 0 : t < 4950 ? 1 : t < 7800 ? 2 : t < S.out ? 3 : -1);
const ROWS = 4;

interface Strip {
  id: string;
  keywords: string[];
  text: string;
  profile: { product_unit: string; price: number; unit_cost: number; rival_name: string; rival_price: number };
  scan: { source: string; title: string; shock: { delta_c_raw: number; delta_lead_time: number; demand_shock: number } | null }[];
  sim: { plan: string; runs: number; futures: { label: string; mean: number; p5: number; payback: number }[]; wins: number };
  headline: string;
  gain: number;
}

const base = { onset_week: 0, ramp_weeks: 0, likelihood: "likely", why: "", source_ids: [], origin: "news", cost_line: null, delta_c_raw: 0, delta_lead_time: 0, demand_shock: 0, rival_price_change_pct: 0, share_shift_pct: 0 } as const;
// ids are never "news": the strip shows no NEWS tag, each shock just carries its own chips
const sc = (id: string, over: Partial<ShockCase>): ShockCase => ({ ...base, ...over, id, label: id }) as ShockCase;
const cut = (t: string, n: number) => (t.length <= n ? t : `${t.slice(0, t.lastIndexOf(" ", n))}…`);

/** The typed line cut into plain runs and keyword runs (the first match of each keyword, in text order). */
function segment(text: string, keywords: string[]) {
  const hits = keywords.map((k) => ({ k, at: text.indexOf(k) })).filter((h) => h.at >= 0).sort((a, b) => a.at - b.at);
  const segs: { s: string; from: number; kw: number }[] = [];
  let i = 0;
  hits.forEach((h, n) => {
    if (h.at > i) segs.push({ s: text.slice(i, h.at), from: i, kw: -1 });
    segs.push({ s: h.k, from: h.at, kw: n });
    i = h.at + h.k.length;
  });
  if (i < text.length) segs.push({ s: text.slice(i), from: i, kw: -1 });
  return { segs, words: hits.map((h) => h.k) };
}

/** Small seeded generator so the fan looks the same every loop and on every machine. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const WEEKS = 26;
interface Path { v: number[]; up: boolean; f: number }

/**
 * Illustrative runs for the drawing: per future, a dozen 26-week paths that dip while the plan ties up cash, climb after
 * its payback week and end spread around that future's simulated mean (spread from its 5th percentile). The numbers
 * shown in words (runs, average, wins) are the recorded ones; these paths only give them a shape.
 */
function makePaths(sim: Strip["sim"]): Path[] {
  const out: Path[] = [];
  sim.futures.forEach((f, i) => {
    const r = rng(11 + i * 7);
    const gauss = () => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
    const sd = Math.max(160, (f.mean - f.p5) / 1.645);
    const dip = -Math.max(250, Math.abs(f.mean) * 0.22);
    const pb = Math.max(3, Math.min(20, f.payback));
    for (let k = 0; k < 12; k++) {
      const end = f.mean + sd * gauss() * 0.8;
      let walk = 0;
      const v = Array.from({ length: WEEKS + 1 }, (_, w) => {
        const x = w / WEEKS;
        walk += (sd * 0.22 * gauss()) / Math.sqrt(WEEKS);
        const bump = w < pb ? Math.sin((Math.PI * w) / pb) : 0;
        return end * x * x * (3 - 2 * x) + dip * bump + walk * Math.sin(Math.PI * x);
      });
      out.push({ v, up: end > 0, f: i });
    }
  });
  // interleave the futures so the fan fills evenly instead of one future at a time
  const r = rng(5);
  return out.map((p) => ({ p, k: r() })).sort((a, b) => a.k - b.k).map((x) => x.p);
}

/** The simulator's fan, drawn in 3 px squares. `p` is ms since the simulator started; everything is a pure function of it. */
function SimCanvas({ paths, p }: { paths: Path[]; p: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const range = useMemo(() => {
    let lo = 0, hi = 0;
    for (const q of paths) for (const v of q.v) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
    const pad = (hi - lo) * 0.08;
    return { lo: lo - pad, hi: hi + pad };
  }, [paths]);

  // the average of today's-news runs: the line the fan collapses to
  const mean = useMemo(() => {
    const mine = paths.filter((q) => q.f === 0);
    return Array.from({ length: WEEKS + 1 }, (_, w) => mine.reduce((s, q) => s + q.v[w], 0) / Math.max(1, mine.length));
  }, [paths]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !size.w || !size.h) return;
    const dpr = window.devicePixelRatio || 1;
    if (el.width !== size.w * dpr) (el.width = size.w * dpr), (el.height = size.h * dpr);
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const cs = getComputedStyle(el);
    const col = (n: string) => cs.getPropertyValue(n).trim() || "#888";
    const up = col("--fl-gain-bar"), dn = col("--fl-loss-bar"), ink = col("--fl-ink"), faint = col("--fl-ink-3");
    const Q = 3;
    const snap = (n: number) => Math.round(n / Q) * Q;
    const X = (w: number) => snap(4 + (w / WEEKS) * (size.w - 8 - Q));
    const Y = (v: number) => snap(((range.hi - v) / (range.hi - range.lo)) * (size.h - Q));

    // "do nothing" is the zero line: every run is measured against it
    ctx.fillStyle = faint;
    const y0 = Y(0) + 1;
    for (let x = 0; x < size.w; x += 6) ctx.fillRect(x, y0, 3, 1);
    ctx.font = "500 8.5px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.fillText("DO NOTHING", size.w - 2, y0 - 4);

    const dim = p > RUN_END ? Math.max(0.16, 1 - (p - RUN_END) / 300) : 1;
    paths.forEach((q, k) => {
      const go = (k / paths.length) * RUN_SPREAD;
      if (p < go) return;
      const head = Math.min(WEEKS, Math.floor(((p - go) / RUN_CROSS) * WEEKS));
      ctx.fillStyle = q.up ? up : dn;
      for (let w = 0; w <= head; w++) {
        ctx.globalAlpha = (w === head && head < WEEKS ? 1 : 0.5) * dim;
        ctx.fillRect(X(w), Y(q.v[w]), Q, Q);
      }
    });
    ctx.globalAlpha = 1;

    if (p > RUN_END) {
      const n = Math.min(WEEKS, Math.floor(((p - RUN_END) / MEAN_DRAW) * WEEKS));
      ctx.fillStyle = ink;
      for (let w = 0; w <= n; w++) ctx.fillRect(X(w) - 1, Y(mean[w]) - 1, Q + 2, Q + 2);
    }
  }, [p, size, paths, range, mean]);

  return <canvas ref={ref} className="hw-cv" />;
}

/** One pixel street: your shop on the left, the rival's on the right. With the plan, seven of the rival's shoppers walk over, one after another. */
function Street({ won }: { won: boolean }) {
  return (
    <svg className="hw-st" viewBox="0 0 64 14" shapeRendering="crispEdges" aria-hidden>
      <rect className="hw-shop y" x="1" y="4" width="6" height="6" />
      <rect className="hw-shop r" x="57" y="4" width="6" height="6" />
      {Array.from({ length: 10 }, (_, i) => {
        const mine = i < 3 || won;
        const j = i < 3 ? i : i - 3;
        const x = mine ? 9 + (i % 5) * 3 : 53 - (j % 4) * 3;
        const y = mine ? (i < 5 ? 4 : 8) : j < 4 ? 4 : 8;
        return <rect key={i} className={`hw-dot ${mine ? "y" : "r"}`} width="2" height="2" style={{ transform: `translate(${x}px, ${y}px)`, transitionDelay: `${i < 3 ? 0 : (i - 3) * 110}ms` }} />;
      })}
    </svg>
  );
}

/**
 * Sends a copy of `from` across to `to`: it lifts, arcs over, grows or shrinks to the target's size and fades as it lands.
 * Three nested layers so each motion keeps its own easing: the path (ease in-out), the lift (up then down) and the size.
 */
function fly(layer: HTMLElement, from: Element, to: Element, dur: number) {
  const L = layer.getBoundingClientRect();
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  if (!a.width || !b.width) return;
  const cs = getComputedStyle(from);
  const path = document.createElement("div");
  const lift = document.createElement("div");
  const body = from.cloneNode(true) as HTMLElement;
  path.className = "hw-fly";
  Object.assign(path.style, { left: `${a.left - L.left}px`, top: `${a.top - L.top}px`, width: `${a.width}px`, height: `${a.height}px` });
  body.removeAttribute("data-fly");
  body.classList.add("hw-flying");
  Object.assign(body.style, { font: cs.font, color: cs.color, width: `${a.width}px`, height: `${a.height}px` });
  lift.appendChild(body);
  path.appendChild(lift);
  layer.appendChild(path);

  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const k = Math.max(0.6, Math.min(3, b.height / a.height));
  const up = Math.min(44, 18 + Math.abs(dx) * 0.08);
  path.animate([{ transform: "translate(0,0)" }, { transform: `translate(${dx}px, ${dy}px)` }], { duration: dur, easing: "cubic-bezier(.55,0,.25,1)", fill: "forwards" });
  lift.animate(
    [
      { transform: "translateY(0)", easing: "cubic-bezier(.2,.7,.4,1)" },
      { transform: `translateY(${-up}px)`, offset: 0.45, easing: "cubic-bezier(.6,0,.8,.3)" },
      { transform: "translateY(0)" },
    ],
    { duration: dur, fill: "forwards" },
  );
  const end = body.animate(
    [
      { transform: "scale(1)", opacity: 1 },
      { transform: `scale(${1.12 * Math.max(1, k * 0.6)})`, opacity: 1, offset: 0.45 },
      { transform: `scale(${k})`, opacity: 1, offset: 0.88 },
      { transform: `scale(${k})`, opacity: 0 },
    ],
    { duration: dur, easing: "ease-in-out", fill: "forwards" },
  );
  end.onfinish = () => path.remove();
  end.oncancel = () => path.remove();
}

const on = (b: boolean) => (b ? " on" : "");

export function HowItWorks({ offline, onTry, onTop }: { offline: boolean; onTry: (() => void) | null; onTop: () => void }) {
  const list = (offline ? stripMock : stripLive) as Strip[];
  const [which, setWhich] = useState(0);
  const d = list[which % list.length];
  const text = useMemo(() => cut(d.text, 112), [d]);
  const { segs, words } = useMemo(() => segment(text, d.keywords), [text, d.keywords]);
  const chips = useMemo(
    () => [
      { k: "Sells", v: d.profile.product_unit.split(" of ")[0] },
      { k: "Price", v: formatPrice(d.profile.price) },
      { k: "Cost", v: formatPrice(d.profile.unit_cost) },
      { k: "Rival", v: `${d.profile.rival_name} · ${formatPrice(d.profile.rival_price)}`, wide: true },
    ],
    [d],
  );
  const rows = useMemo(() => d.scan.slice(0, ROWS).map((n) => ({ ...n, sh: n.shock ? sc("n", n.shock) : null })), [d]);
  const hitOrder = useMemo(() => rows.map((r, i) => (r.sh ? i : -1)).filter((i) => i >= 0), [rows]);
  const first = rows[hitOrder[0] ?? 0];
  const paths = useMemo(() => makePaths(d.sim), [d]);
  const runs = d.sim.runs.toLocaleString("en-US");
  const total = d.sim.futures.length;
  const headWords = useMemo(() => d.headline.split(" "), [d]);
  const sr =
    `Preview of one recorded run (${d.profile.product_unit}, rival ${d.profile.rival_name}). A one-line description becomes price, cost and rival, and its keywords go to a news search. ` +
    `Of ${rows.length} stories found, ${hitOrder.length} hit the business's costs; the first becomes the shock to test. ` +
    `The simulator runs the plan "${d.sim.plan}" ${runs} times in each of ${total} futures; it beats doing nothing in ${d.sim.wins}. ` +
    `The memo recommends: ${d.headline}, worth ${formatDelta(d.gain)} over six months.`;

  const root = useRef<HTMLElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(0);
  const clock = useRef(0);
  const [still, setStill] = useState(false);
  const [visible, setVisible] = useState(false);
  const [phone, setPhone] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia?.("(max-width: 560px)");
    if (!mq) return;
    const sync = () => setPhone(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // reduced motion: no loop, every box in its final state
  useEffect(() => {
    if (reducedMotion()) {
      setStill(true);
      setT(STILL);
    }
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // the hand-offs, fired once per loop when the clock passes them
  const flights = useMemo(
    () => [
      ...words.map((_, i) => ({ at: S.fly1 + i * 110, from: `k${i}`, to: `q${i}` })),
      { at: S.fly2, from: "tag0", to: "shock" },
      { at: S.fly3, from: "best", to: "num" },
    ],
    [words],
  );

  // the loop reads the hand-offs through a ref, so a new run's keywords never restart (and double) the clock
  const flightsRef = useRef(flights);
  flightsRef.current = flights;

  useEffect(() => {
    if (still || !visible) return;
    let alive = true;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      if (!alive) return;
      const dt = Math.min(50, now - last);
      last = now;
      const prev = clock.current;
      const wrap = prev + dt >= S.loop;
      clock.current = wrap ? 0 : prev + dt;
      if (wrap) setWhich((n) => n + 1);
      const cur = clock.current;
      const host = root.current;
      if (host && layer.current && cur > prev) {
        for (const f of flightsRef.current) {
          if (prev < f.at && cur >= f.at) {
            const a = host.querySelector(`[data-fly="${f.from}"]`);
            const b = host.querySelector(`[data-fly="${f.to}"]`);
            if (a && b) fly(layer.current, a, b, FLY);
          }
        }
      }
      setT(cur);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [still, visible]);

  // One column (phone) only shows a box or two at a time, so there each box keeps its finished state and replays only from the
  // moment the data reaches it; side by side, all four share one clock and the whole strip fades out at the end of the loop.
  const tb = W.map((w) => (phone && !still && t < w ? STILL : t));
  const lit = act(t);
  const out = !still && !phone && t >= S.out;
  const reset = (i: number) => !still && (phone ? t >= W[i] && t < W[i] + 120 : t < 120);
  const landed = (at: number, x: number) => x >= at + FLY - 80;
  const passing = (at: number, x: number) => x >= at && x < at + FLY + 220;

  // box 1
  const typed = Math.floor(Math.min(1, tb[0] / S.typeEnd) * text.length);
  // box 2
  const scan = Math.max(0, Math.min(1, (tb[1] - S.scan) / (S.scanEnd - S.scan)));
  const locked = (i: number) => tb[1] >= S.lock + Math.max(0, hitOrder.indexOf(i)) * S.lockGap;
  // box 3
  const p = Math.max(0, tb[2] - S.sim);
  const ran = Math.round(Math.min(1, p / RUN_END) * d.sim.runs).toLocaleString("en-US");

  return (
    <section ref={root} className={`hw${out ? " out" : ""}`} aria-label="How it works">
      <ol className="hw-list">
        <li className={`hw-p${lit === 0 ? " act" : ""}${reset(0) ? " rst" : ""}${on(passing(S.fly1, tb[0]))}`}>
          <div className="hw-scr" aria-hidden>
            <div className="hw-box">
              {segs.map((g) => {
                const s = g.s.slice(0, Math.max(0, typed - g.from));
                if (!s) return null;
                return g.kw < 0 ? (
                  <span key={g.from}>{s}</span>
                ) : (
                  <mark key={g.from} className={`hw-kw${on(tb[0] >= S.kw + g.kw * 90)}`} data-fly={`k${g.kw}`}>
                    {s}
                  </mark>
                );
              })}
              {tb[0] < S.typeEnd + 150 && <i className="hw-caret" />}
            </div>
            <div className="hw-chips">
              {chips.map((c, i) => (
                <span key={c.k} className={`hw-pchip${on(tb[0] >= S.chips + i * 90)}${c.wide ? " wide" : ""}`}>
                  <small>{c.k}</small>
                  <b>{c.v}</b>
                </span>
              ))}
            </div>
          </div>
          <span className="n">1</span>
          <b>{HOW[0].t}</b>
          <small>{HOW[0].d}</small>
        </li>

        <li className={`hw-p${lit === 1 ? " act" : ""}${reset(1) ? " rst" : ""}${on(passing(S.fly2, tb[1]))}`}>
          <div className="hw-scr" aria-hidden>
            <div className="hw-search">
              <span className="hw-tav">Tavily</span>
              <span className="hw-qs">
                {words.map((w, i) => (
                  <span key={w} className={`hw-q${on(landed(S.fly1 + i * 110, tb[1]))}`} data-fly={`q${i}`}>
                    {w}
                  </span>
                ))}
              </span>
              <span className="hw-scan" style={{ transform: `scaleX(${scan})`, opacity: scan > 0 && tb[1] < S.scanEnd + 250 ? 1 : 0 }} />
            </div>
            <div className={`hw-reel${on(tb[1] >= S.reel)}`} style={{ "--n": rows.length } as React.CSSProperties}>
              <div className="hw-reel-in">
                {[0, 1, 2].flatMap((copy) =>
                  rows.map((r, i) => {
                    const real = copy === 2;
                    const state = !real ? "" : r.sh ? (locked(i) ? " hit" : "") : tb[1] >= S.lock ? " miss" : "";
                    return (
                      <div key={`${copy}-${i}`} className={`hw-row${state}`}>
                        <span className="hw-src">{r.source}</span>
                        <span className="hw-nt">{r.title}</span>
                        {real && r.sh && (
                          <span className={`hw-nc${on(locked(i))}`} data-fly={i === hitOrder[0] ? "tag0" : undefined}>
                            <FutureHead shock={r.sh} />
                          </span>
                        )}
                      </div>
                    );
                  }),
                )}
              </div>
            </div>
            <p className={`hw-found${on(tb[1] >= S.lock + 200)}`}>
              <b>{hitOrder.length}</b> of {rows.length} stories hit your costs
            </p>
          </div>
          <span className="n">2</span>
          <b>{HOW[1].t}</b>
          <small>{HOW[1].d}</small>
        </li>

        <li className={`hw-p${lit === 2 ? " act" : ""}${reset(2) ? " rst" : ""}${on(passing(S.fly3, tb[2]))}`}>
          <div className="hw-scr hw-sim" aria-hidden>
            <div className="hw-sh">
              <span className="hw-lab">Simulator</span>
              <span className="hw-runs">
                <b>{ran}</b> runs
              </span>
            </div>
            <div className="hw-plan">
              <span className="hw-lab">Plan</span>
              <span>{d.sim.plan}</span>
            </div>
            <div className="hw-plan">
              <span className="hw-lab">Shock</span>
              <span className={`hw-shock${on(landed(S.fly2, tb[2]))}`} data-fly="shock">
                {first?.sh && <FutureHead shock={first.sh} />}
              </span>
            </div>
            <div className={`hw-chart${on(tb[2] >= S.sim)}`}>
              <SimCanvas paths={paths} p={p} />
              <div className={`hw-outc${on(tb[2] >= S.card)}`}>
                <b className="hw-v" data-fly="best">
                  {formatDelta(d.gain)}
                </b>
                <span>
                  vs doing nothing
                  <br />
                  wins in <b>{d.sim.wins}</b> of <b>{total}</b> futures
                </span>
              </div>
            </div>
          </div>
          <span className="n">3</span>
          <b>{HOW[2].t}</b>
          <small>{HOW[2].d}</small>
        </li>

        <li className={`hw-p${lit === 3 ? " act" : ""}${reset(3) ? " rst" : ""}`}>
          <div className={`hw-scr hw-memo${on(tb[3] >= S.hero)}`} aria-hidden>
            <small className="hw-ov">Recommended</small>
            <h4 className={`hw-head${on(tb[3] >= S.words)}`}>
              {headWords.map((w, i) => (
                <span key={i} className="hw-w">
                  <span style={{ transitionDelay: `${i * 45}ms` }}>{w}</span>
                </span>
              ))}
            </h4>
            <div className="hw-numrow">
              <b className={`hw-num${on(still || landed(S.fly3, tb[3]))}`} data-fly="num">
                {formatDelta(d.gain)}
              </b>
              <span className={`hw-stamp${on(tb[3] >= S.stamp)}`}>Tested {runs}×</span>
            </div>
            <em className={on(still || landed(S.fly3, tb[3]))}>more profit over 6 months</em>
            <div className={`hw-walk${on(tb[3] >= S.walk - 250)}`}>
              <Street won={tb[3] >= S.walk} />
              <span>
                <i>You</i>
                <i>{d.profile.rival_name}</i>
              </span>
            </div>
          </div>
          <span className="n">4</span>
          <b>{HOW[3].t}</b>
          <small>{HOW[3].d}</small>
        </li>
      </ol>
      <div ref={layer} className="hw-layer" aria-hidden />
      <p className="hw-sr">{sr}</p>

      <div className="hw-cta">
        {onTry && (
          <button type="button" className="fl-btn hw-go" onClick={onTry}>
            Try it on a coffee roaster
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        <button type="button" className="hw-up" onClick={onTop}>
          {onTry ? "or describe your own business" : "Describe your own business"} ↑
        </button>
      </div>
    </section>
  );
}
