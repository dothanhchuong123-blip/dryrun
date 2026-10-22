"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TickEventData } from "../../lib/events";
import { reducedMotion } from "../../lib/follow";
import { formatDelta } from "../../lib/format";
import { cellKey, useMarketStore } from "../../lib/store";
import { api, connectReplayStream } from "../../lib/stream";
import { TwinScene } from "./TwinScene";
import "./replay.css";

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

  // the clock: one week per beat while on screen; stops on the end card
  const firstTick = rows.u1.length > 0;
  useEffect(() => {
    if (still || !firstTick || !onScreen || atEnd) {
      setPlaying(false);
      return;
    }
    setPlaying(true);
    const t = setInterval(() => {
      setWeek((w) => (w + 1 < live.current.n ? w + 1 : w));
    }, weekMs);
    return () => clearInterval(t);
  }, [still, firstTick, onScreen, atEnd, weekMs]);

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
  const you = profile?.business_name ?? "You";
  const rival = profile?.rival_name ?? "Rival";

  if (failed) return null;
  return (
    <section ref={root} className="am-sec am-twins" aria-label="One run, two futures">
      <div className="mt-head">
        <h2>One run, two futures</h2>
        <div className="mt-tags">
          <span className="mt-wk">WEEK {Math.min(week + 1, weeks)} / {weeks}</span>
          <span className={`mt-gap ${gap >= 0 ? "pos" : "neg"}`}>
            GAP <b>{u1 && u2 ? formatDelta(gap) : "–"}</b>
          </span>
        </div>
      </div>
      <div className="rp-twins mt-twins">
        <TwinScene tick={u2} title="DO NOTHING" kind="none" you={you} rival={rival} />
        <TwinScene tick={u1} title="WITH THE PLAN" kind="plan" you={you} rival={rival} />
      </div>
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
