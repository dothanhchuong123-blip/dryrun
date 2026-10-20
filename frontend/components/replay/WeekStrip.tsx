"use client";

import { useMemo } from "react";
import type { MarkerData, TickEventData } from "../../lib/events";
import { formatDelta, formatMoney } from "../../lib/format";

const MAX_BLOCKS = 6;

/** 1, 2 or 5 × 10^k: the smallest "nice" block value that keeps the biggest week within MAX_BLOCKS. */
function niceStep(maxAbs: number): number {
  const raw = Math.max(maxAbs / (MAX_BLOCKS - 0.5), 1);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const m = raw / pow;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * pow;
}

/**
 * The week strip: one column per week, a stack of square blocks going up (green) when the plan made more
 * than doing nothing that week and down (coral) when it made less. Weeks not reached yet are faint outlines.
 */
export function WeekStrip({
  u1,
  u2,
  weeks,
  week,
  markers,
  onSeek,
}: {
  u1: TickEventData[];
  u2: TickEventData[];
  weeks: number;
  week: number;
  markers: MarkerData[];
  onSeek(week: number): void;
}) {
  const n = Math.min(u1.length, u2.length);
  const gaps = useMemo(() => Array.from({ length: n }, (_, i) => u1[i].profit[0] - u2[i].profit[0]), [u1, u2, n]);
  const step = useMemo(() => niceStep(Math.max(0, ...gaps.map(Math.abs))), [gaps]);
  const byWeek = useMemo(() => {
    const m: Record<number, MarkerData[]> = {};
    for (const k of markers) (m[k.week] ??= []).push(k);
    return m;
  }, [markers]);

  return (
    <div className="wk">
      <div className="wk-grid" style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }}>
        {Array.from({ length: weeks }, (_, i) => {
          const reached = i <= week && i < n;
          const g = i < n ? gaps[i] : 0;
          const k = reached && Math.abs(g) >= step * 0.15 ? Math.min(MAX_BLOCKS, Math.max(1, Math.round(Math.abs(g) / step))) : 0;
          const up = g >= 0;
          const mk = byWeek[i];
          const label = `Week ${i + 1}${i < n ? `: ${formatDelta(g)} vs doing nothing` : ""}${mk ? `. ${mk.map((m) => m.text).join("; ")}` : ""}`;
          return (
            <button key={i} type="button" className={`wk-col${i === week ? " cur" : ""}${reached ? "" : " ahead"}`} onClick={() => onSeek(i)} aria-label={label} title={label}>
              <span className="wk-mk">{mk && <i className={mk.some((m) => m.kind === "shock") ? "sh" : ""} />}</span>
              <span className="wk-half hi">
                {Array.from({ length: MAX_BLOCKS }, (_, b) => (
                  <i key={b} className={reached && up && b < k ? "on g" : !reached && b === 0 ? "ghost" : ""} />
                ))}
              </span>
              <span className="wk-mid" />
              <span className="wk-half lo">
                {Array.from({ length: MAX_BLOCKS }, (_, b) => (
                  <i key={b} className={reached && !up && b < k ? "on r" : !reached && b === 0 ? "ghost" : ""} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="wk-axis">
        <span>WK 1</span>
        <span>1 block = {formatMoney(step)} · up = plan ahead that week · down = plan behind</span>
        <span>WK {weeks}</span>
      </div>
    </div>
  );
}
