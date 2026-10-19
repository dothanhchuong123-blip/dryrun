"use client";

/**
 * The "Test plans" stage is a show: whatever the stream has already delivered is replayed one beat at a
 * time, so a user who lingers on the news still gets to watch the analyst think, the shoppers react and
 * the simulator fill the grid. The stream is never delayed; only what is on screen is.
 *
 * `useTimeline` records arrival order across the store's separate collections (steps, plans, crowd, cells),
 * which the store itself does not keep. `usePacer` reveals that list beat by beat while `active`.
 */
import { useEffect, useRef, useState } from "react";
import { reducedMotion } from "./follow";
import { useMarketStore, type MarketState } from "./store";

export type Beat =
  | { kind: "step"; seq: number; words: number }
  | { kind: "plan"; name: string }
  | { kind: "crowd"; plan: string }
  | { kind: "cell"; key: string };

function collect(s: MarketState, seen: Set<string>, out: Beat[]) {
  for (const st of s.agentSteps) {
    const id = `s:${st.seq}`;
    if (!seen.has(id)) {
      seen.add(id);
      out.push({ kind: "step", seq: st.seq, words: st.text.split(/\s+/).length });
    }
  }
  for (const p of s.plans) {
    const id = `p:${p.name}`;
    if (!seen.has(id)) {
      seen.add(id);
      out.push({ kind: "plan", name: p.name });
    }
  }
  for (const plan of Object.keys(s.crowdByPlan)) {
    const id = `c:${plan}`;
    if (!seen.has(id)) {
      seen.add(id);
      out.push({ kind: "crowd", plan });
    }
  }
  for (const key of Object.keys(s.cells)) {
    const id = `g:${key}`;
    if (!seen.has(id)) {
      seen.add(id);
      out.push({ kind: "cell", key });
    }
  }
}

/** Every beat the stream has delivered for the current analysis, in arrival order. */
export function useTimeline(): Beat[] {
  const [beats, setBeats] = useState<Beat[]>([]);
  const ref = useRef<{ seen: Set<string>; list: Beat[] }>({ seen: new Set(), list: [] });
  useEffect(() => {
    const sync = (s: MarketState) => {
      const r = ref.current;
      // a new run (or a reset) starts a new show. Not keyed on the id: it can change once the stream opens.
      const fresh = (s.analysis.status === "idle" || s.analysis.status === "starting") && r.list.length > 0;
      if (fresh) {
        r.seen = new Set();
        r.list = [];
      }
      const before = r.list.length;
      collect(s, r.seen, r.list);
      if (fresh || r.list.length !== before) setBeats(r.list.slice());
    };
    sync(useMarketStore.getState());
    return useMarketStore.subscribe(sync);
  }, []);
  return beats;
}

/** How long a beat stays the newest thing on screen (ms). Steps get reading time. */
function hold(b: Beat): number {
  switch (b.kind) {
    case "step":
      return Math.min(2000, Math.max(700, b.words * 45 + 350));
    case "plan":
      return 380;
    case "crowd":
      return 520;
    case "cell":
      return 130;
  }
}

/** How many beats are on screen. Grows while `active`; never shrinks unless the list does. */
export function usePacer(beats: Beat[], active: boolean, speed = 1): number {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (shown > beats.length) setShown(beats.length);
  }, [beats.length, shown]);
  useEffect(() => {
    if (!active || shown >= beats.length) return;
    if (reducedMotion()) {
      setShown(beats.length);
      return;
    }
    // the newest beat on screen holds before the next one appears
    const wait = shown > 0 ? hold(beats[shown - 1]) : 300;
    const t = window.setTimeout(() => setShown((n) => n + 1), wait / speed);
    return () => window.clearTimeout(t);
  }, [active, shown, beats, speed]);
  return Math.min(shown, beats.length);
}
