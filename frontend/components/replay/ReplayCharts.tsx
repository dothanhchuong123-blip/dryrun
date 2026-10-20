"use client";

import type { TickEventData } from "../../lib/events";
import { formatDelta, formatPrice } from "../../lib/format";

function niceRange(lo: number, hi: number): [number, number] {
  if (!(hi > lo)) return [lo - 1, hi + 1];
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad];
}

/** "Your plan pulls ahead from week 7 (+$7.4k in this run)" — states the finding, from the loaded ticks. */
export function chartTitle(u1: TickEventData[], u2: TickEventData[], done: boolean): string {
  const n = Math.min(u1.length, u2.length);
  if (n === 0) return "Simulating this plan…";
  const diffs = Array.from({ length: n }, (_, i) => u1[i].cum_profit[0] - u2[i].cum_profit[0]);
  const end = diffs[n - 1];
  let behind = -1;
  for (let i = 0; i < n; i++) if (diffs[i] <= 0) behind = i;
  if (end <= 0) return `Your plan ends ${formatDelta(end) === "$0" ? "level with" : "behind"} doing nothing (${formatDelta(end)} in this run)${done ? "" : " so far"}`;
  if (behind < 0) return `Your plan is ahead from the start (${formatDelta(end)} in this run)`;
  return `Your plan pulls ahead from week ${behind + 2} (${formatDelta(end)} in this run)`;
}


// ---- Analyst view: price/cost, stock, bullwhip ----------------------------------------------------

interface Series {
  label: string;
  color: string;
  values: (number | null)[];
  dashed?: boolean;
}

function MiniLine({ title, series, week, fmt, weeks }: { title: string; series: Series[]; week: number; fmt: (v: number) => string; weeks: number }) {
  const W = 420;
  const H = 130;
  const pad = { l: 6, r: 6, t: 10, b: 18 };
  const vals = series.flatMap((s) => s.values).filter((v): v is number => v != null && Number.isFinite(v));
  if (vals.length === 0) {
    return (
      <div className="rp-mini">
        <h4>{title}</h4>
        <div className="rp-mini-empty">Shows up after week 8</div>
      </div>
    );
  }
  const [lo, hi] = niceRange(Math.min(...vals), Math.max(...vals));
  const x = (i: number) => pad.l + (i / Math.max(1, weeks - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  return (
    <div className="rp-mini">
      <h4>
        {title}
        <span className="rp-key">
          {series.map((s) => (
            <span key={s.label}>
              <i style={{ background: s.dashed ? "transparent" : s.color, borderTop: s.dashed ? `2px dashed ${s.color}` : undefined }} />
              {s.label}
              {s.values[week] != null && <b className="num"> {fmt(s.values[week] as number)}</b>}
            </span>
          ))}
        </span>
      </h4>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="var(--fl-line-2)" />
        {series.map((s) => {
          let d = "";
          s.values.forEach((v, i) => {
            if (v == null || !Number.isFinite(v)) return;
            d += `${d && s.values[i - 1] != null ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
          });
          return <path key={s.label} d={d} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "5 4" : undefined} strokeLinejoin="round" />;
        })}
        <line x1={x(week)} x2={x(week)} y1={pad.t - 4} y2={H - pad.b} stroke="var(--fl-ink)" opacity="0.5" />
        <text x={pad.l} y={H - 4} fontSize="10" fill="var(--fl-ink-3)">Wk 1</text>
        <text x={W - pad.r} y={H - 4} fontSize="10" fill="var(--fl-ink-3)" textAnchor="end">{weeks}</text>
      </svg>
    </div>
  );
}

export function AnalystCharts({
  u1,
  weeks,
  week,
  you,
  rival,
}: {
  u1: TickEventData[];
  weeks: number;
  week: number;
  you: string;
  rival: string;
}) {
  const col = (f: (t: TickEventData) => number | null) => u1.map(f);
  const hasBull = u1.some((t) => t.bullwhip[0] != null);
  return (
    <div className="rp-analyst">
      <MiniLine
        title="Price and cost"
        weeks={weeks}
        week={week}
        fmt={formatPrice}
        series={[
          { label: `${you} price`, color: "var(--px-you)", values: col((t) => t.price[0]) },
          { label: `${rival} price`, color: "var(--px-rival)", values: col((t) => t.price[1]) },
          { label: "Your cost", color: "var(--fl-ink-3)", values: col((t) => t.unit_cost[0]), dashed: true },
        ]}
      />
      <MiniLine
        title="Stock on hand (weeks)"
        weeks={weeks}
        week={week}
        fmt={(v) => `${v.toFixed(1)} wk`}
        series={[
          { label: you, color: "var(--px-you)", values: col((t) => t.cover_weeks[0]) },
          { label: rival, color: "var(--px-rival)", values: col((t) => t.cover_weeks[1]) },
        ]}
      />
      {hasBull && (
        <MiniLine
          title="Order swings (bullwhip)"
          weeks={weeks}
          week={week}
          fmt={(v) => `${v.toFixed(1)}×`}
          series={[
            { label: you, color: "var(--px-you)", values: col((t) => t.bullwhip[0]) },
            { label: rival, color: "var(--px-rival)", values: col((t) => t.bullwhip[1]) },
          ]}
        />
      )}
    </div>
  );
}
