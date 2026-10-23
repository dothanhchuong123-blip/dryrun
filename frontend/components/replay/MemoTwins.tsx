"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TickEventData } from "../../lib/events";
import { leanOf, moodOf, shopperOf } from "../../lib/faces";
import { reducedMotion } from "../../lib/follow";
import { formatDelta } from "../../lib/format";
import { cellKey, useMarketStore } from "../../lib/store";
import { api, connectReplayStream } from "../../lib/stream";
import { TwinScene } from "./TwinScene";
import "./replay.css";

const HOLD_MS = 1400; // extra pause on a week with a big moment
const VOICE_WEEKS = 4; // a new shopper speaks every 4 weeks, for 3 of them
const soldOut = (t: TickEventData) => t.unmet[0] > 0.5 || t.cover_weeks[0] < 0.05;

const money1 = (x: number) => `${x < 0 ? "−" : ""}$${(Math.abs(x) / 1000).toFixed(1)}k`;

/**
 * The twin pixel worlds on the answer page (DESIGN §12.6): the recommended plan against "Do nothing" in one future,
 * playing by itself once it scrolls into view and pausing when it leaves. It reads the same replay stream and draws
 * with the same TwinScene as the full replay, but keeps its own copy of the ticks so it never touches the drawer's state.
 * Sprite positions stay inside TwinScene's refs; this component only updates once per week.
 */
export function MemoTwins({ planName, shockId, onFull }: { planName: string; shockId: string; onFull: () => void }) {
  const analysisId = useMarketStore((s) => s.analysis.id);
  const spec = useMarketStore((s) => s.plans.find((p) => p.name === planName)?.spec);
  const shockLabel = useMarketStore((s) => s.shocks.find((x) => x.id === shockId)?.label ?? null);
  const cell = useMarketStore((s) => s.cells[cellKey(planName, shockId)]);
  const profile = useMarketStore((s) => s.profile);
  const crowd = useMarketStore((s) => s.crowdByPlan[planName]);
  const headline = useMarketStore((s) => (s.news.find((n) => n.kind === "supply" && n.applied) ?? s.news.find((n) => n.kind === "supply"))?.title ?? null);

  const root = useRef<HTMLElement>(null);
  const [rows, setRows] = useState<{ u1: TickEventData[]; u2: TickEventData[] }>({ u1: [], u2: [] });
  const [week, setWeek] = useState(0);
  const [weeks, setWeeks] = useState(24);
  const [weekMs, setWeekMs] = useState(400);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [seen, setSeen] = useState(false); // has been on screen once: starts the stream
  const [onScreen, setOnScreen] = useState(false);
  const [still] = useState(() => reducedMotion());
  const started = useRef(false);
  const stop = useRef<(() => void) | null>(null);
  const pending = useRef<TickEventData | null>(null);
  const live = useRef({ n: 0, done: false });
  live.current = { n: rows.u1.length, done };

  // in view: autoplay; out of view: pause
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      setOnScreen(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => {
      setOnScreen(e.isIntersecting);
      if (e.isIntersecting) setSeen(true);
    }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // the stream starts the first time the block is seen
  useEffect(() => {
    if (!seen || started.current || !analysisId) return;
    started.current = true;
    (async () => {
      try {
        const res = await api.startReplay(analysisId, planName, shockId, spec);
        stop.current = connectReplayStream(
          res.replay_id,
          (ev) => {
            if (ev.event === "replay_start") {
              setWeeks(ev.data.weeks);
              setWeekMs(Math.max(150, ev.data.week_seconds * 1000));
            } else if (ev.event === "tick") {
              if (ev.data.universe === "U1") pending.current = ev.data;
              else if (pending.current) {
                const a = pending.current;
                pending.current = null;
                setRows((r) => ({ u1: [...r.u1, a], u2: [...r.u2, ev.data] }));
              }
            } else if (ev.event === "replay_done") setDone(true);
          },
          () => setFailed(true),
          { planName, shockId, spec },
        );
      } catch {
        setFailed(true);
      }
    })();
  }, [seen, analysisId, planName, shockId, spec]);
  useEffect(() => () => stop.current?.(), []);

  const last = rows.u1.length - 1;
  const atEnd = done && week >= last && last >= 0;

  // reduced motion: no autoplay, show the last week as a still once it has arrived
  useEffect(() => {
    if (still && done && last >= 0) setWeek(last);
  }, [still, done, last]);

  const play = useCallback(() => {
    setWeek(0);
    setPlaying(true);
    if (still) {
      // a still-motion visitor asked for it: step through at the same beat
      let w = 0;
      const t = setInterval(() => {
        w += 1;
        setWeek(Math.min(w, live.current.n - 1));
        if (w >= live.current.n - 1) clearInterval(t);
      }, weekMs);
    }
  }, [still, weekMs]);

  const u1 = rows.u1[week];
  const u2 = rows.u2[week];
  const gap = u1 && u2 ? u1.cum_profit[0] - u2.cum_profit[0] : 0;
  // payback: first week after which the cumulative gap stays >= 0 (from the whole recorded run, so known once it has arrived)
  const gaps = rows.u1.map((a, i) => a.cum_profit[0] - rows.u2[i].cum_profit[0]);
  const dips = gaps.some((g) => g < 0);
  let payback: number | null = null; // 0-based index of the payback week; null = never pays back (or not known yet)
  if (done && dips && gaps[gaps.length - 1] >= 0) {
    payback = gaps.length - 1;
    while (payback > 0 && gaps[payback - 1] >= 0) payback -= 1;
  }
  const neverPays = done && dips && gaps[gaps.length - 1] < 0;
  const early = !!(u1 && u2) && gap < 0 && (payback === null || week < payback);
  // one cash scale for both jars and the race: the biggest cumulative profit seen so far in either world
  let cashMax = 1;
  for (let i = 0; i < rows.u1.length; i++) cashMax = Math.max(cashMax, rows.u1[i].cum_profit[0], rows.u2[i].cum_profit[0]);
  cashMax *= 1.05;
  const bar = (x: number) => `${Math.max(0, Math.min(1, x / cashMax)) * 100}%`;
  const you = profile?.business_name ?? "You";
  const rival = profile?.rival_name ?? "Rival";

  // big moments (from the whole recorded run): the clock holds on these weeks and a banner names them
  const moments = useMemo(() => {
    const m = new Map<number, string[]>();
    const add = (w: number, text: string) => m.set(w, [...(m.get(w) ?? []), text]);
    const { u1: a, u2: b } = rows;
    const first = (test: (i: number) => boolean) => {
      for (let i = 1; i < a.length; i++) if (test(i)) return i;
      return -1;
    };
    const price = first((i) => Math.abs(a[i].price[0] / a[i - 1].price[0] - 1) > 0.005);
    if (price > 0) add(price, `Price ${a[price].price[0] > a[price - 1].price[0] ? "up" : "down"} to $${a[price].price[0].toFixed(2)}`);
    const lands = first((i) => a[i].in_transit[0] < a[i - 1].in_transit[0] - 0.5);
    if (lands > 0) add(lands, "Stock lands");
    const outB = first((i) => soldOut(b[i]) && !soldOut(b[i - 1]));
    if (outB > 0) add(outB, "Do nothing sells out");
    const outA = first((i) => soldOut(a[i]) && !soldOut(a[i - 1]));
    if (outA > 0) add(outA, "The plan sells out");
    return m;
  }, [rows]);
  const moment = [...(moments.get(week) ?? []), ...(payback !== null && week === payback ? ["Paid back"] : [])];

  // the clock: one week per beat while on screen, holding on big moments; stops on the end card
  const firstTick = rows.u1.length > 0;
  const holdNow = moment.length > 0;
  useEffect(() => {
    if (still || !firstTick || !onScreen || atEnd) {
      setPlaying(false);
      return;
    }
    setPlaying(true);
    const t = setTimeout(() => {
      setWeek((w) => (w + 1 < live.current.n ? w + 1 : w));
    }, weekMs + (holdNow ? HOLD_MS : 0));
    return () => clearTimeout(t);
  }, [still, firstTick, onScreen, atEnd, weekMs, week, rows.u1.length, holdNow]);


  // the plan's shoppers speak in turn, the most decided first; Nemotron's "Firm A/B" become the real names
  const voices = useMemo(
    () =>
      [...(crowd ?? [])]
        .filter((c) => c.bubble?.trim())
        .sort((x, y) => Math.abs(y.mu[0]) - Math.abs(x.mu[0]))
        .slice(0, 5)
        .map((c) => ({
          shopper: shopperOf(c),
          mood: moodOf(c),
          lean: leanOf(c),
          text: c.bubble.replace(/\bfirm a\b/gi, you).replace(/\bfirm b\b/gi, rival),
        })),
    [crowd, you, rival],
  );
  const beat = Math.floor((week - 1) / VOICE_WEEKS);
  const voice = !atEnd && week >= 1 && (week - 1) % VOICE_WEEKS < VOICE_WEEKS - 1 && voices.length ? voices[beat % voices.length] : null;

  if (failed) return null;
  return (
    <section ref={root} className="am-sec am-twins" aria-label="One run, two futures">
      <div className="mt-head">
        <h2>One run, two futures</h2>
        <div className="mt-tags">
          <span className="mt-wk">WEEK {Math.min(week + 1, weeks)} / {weeks}</span>
          <span className={`mt-gap ${gap >= 0 ? "pos" : early ? "early" : "neg"}`}>
            GAP <b>{u1 && u2 ? formatDelta(gap) : "–"}</b>
          </span>
        </div>
      </div>
      {(dips || early) && (
        <div className="mt-pay">
          <div className="mt-track" aria-hidden="true">
            <i className="mt-fill" style={{ width: `${(Math.min(week + 1, weeks) / weeks) * 100}%` }} />
            {payback !== null && (
              <span className="mt-tick" style={{ left: `${((payback + 1) / weeks) * 100}%` }}>
                <em>pays back wk {payback + 1}</em>
              </span>
            )}
          </div>
          <div className="mt-paynote" role="status">
            {early
              ? payback !== null
                ? `Early weeks run behind (up-front costs) · pays back by week ${payback + 1}`
                : neverPays
                  ? "Early weeks run behind (up-front costs) · doesn't pay back in this run"
                  : "Early weeks run behind (up-front costs)"
              : neverPays
                ? "Doesn't pay back in this run"
                : payback !== null && week >= payback
                  ? `Paid back in week ${payback + 1}`
                  : ""}
          </div>
        </div>
      )}
      {shockLabel && (
        <div className="mt-news">
          <span className="lbl">THE NEWS</span>
          <span className="clip">
            <span className="roll">{headline ? `${shockLabel} · ${headline} · ${shockLabel}` : shockLabel}</span>
          </span>
        </div>
      )}
      <div className="mt-stage">
        <div className="rp-twins mt-twins">
          <TwinScene tick={u2} twin={u1} title="DO NOTHING" kind="none" you={you} rival={rival} cashMax={cashMax} baseCost={profile?.unit_cost} />
          <TwinScene tick={u1} twin={u2} title="WITH THE PLAN" kind="plan" you={you} rival={rival} cashMax={cashMax} baseCost={profile?.unit_cost} voice={voice} />
        </div>
        {moment.length > 0 && (
          <div key={week} className="mt-moment" role="status">
            WEEK {week + 1} · {moment.join(" · ")}
          </div>
        )}
      </div>
      {u1 && u2 && (
        <div className="mt-race" aria-label="Cash so far in this run">
          <div className="over">CASH SO FAR · THIS RUN</div>
          <div className="mt-row">
            <span>Do nothing</span>
            <div className="bar"><i style={{ width: bar(u2.cum_profit[0]) }} /></div>
            <b className={u2.cum_profit[0] < 0 ? "neg" : ""}>{money1(u2.cum_profit[0])}</b>
          </div>
          <div className="mt-row p">
            <span>With the plan</span>
            <div className="bar"><i style={{ width: bar(u1.cum_profit[0]) }} /></div>
            <b className={u1.cum_profit[0] < 0 ? "neg" : ""}>{money1(u1.cum_profit[0])}</b>
          </div>
        </div>
      )}
      <div className="mt-foot">
        <div className="mt-note">
          {shockLabel ? <span>{shockLabel}. </span> : null}
          {cell ? (
            <span>
              One sample run · the average of {cell.n.toLocaleString("en-US")} runs is <b>{formatDelta(cell.mean_delta_usd)}</b>
            </span>
          ) : (
            <span>One sample run</span>
          )}
          {atEnd && u1 && u2 && <span> · this run: {money1(u2.cum_profit[0])} → {money1(u1.cum_profit[0])}</span>}
        </div>
        <div className="mt-btns">
          {(atEnd || (still && !playing)) && (
            <button type="button" className="fl-btn2" onClick={play} aria-label="Play this run again">
              {atEnd ? "↻ Replay" : "▶ Play"}
            </button>
          )}
          <button type="button" className="fl-btn2" onClick={onFull}>
            Watch full run ▸
          </button>
        </div>
      </div>
    </section>
  );
}
