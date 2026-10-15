"use client";

import { useMemo } from "react";
import type { MarkerData, TickEventData } from "../../lib/events";
import { formatDelta, formatMoney, formatPrice } from "../../lib/format";

const CW = 900;
const CH = 140;
const M = { l: 8, r: 150, t: 14, b: 22 };

function niceRange(lo: number, hi: number): [number, number] {
  if (!(hi > lo)) return [lo - 1, hi + 1];
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad];
}

/** "Your plan pulls ahead from week 7 (+$7.4k)" — states the finding, from the loaded ticks. */
export function chartTitle(u1: TickEventData[], u2: TickEventData[], done: boolean): string {
  const n = Math.min(u1.length, u2.length);
  if (n === 0) return "Simulating this plan…";
  const diffs = Array.from({ length: n }, (_, i) => u1[i].cum_profit[0] - u2[i].cum_profit[0]);
  const end = diffs[n - 1];
  let behind = -1;
  for (let i = 0; i < n; i++) if (diffs[i] <= 0) behind = i;
  if (end <= 0) return `Your plan ends ${formatDelta(end) === "$0" ? "level with" : "behind"} doing nothing (${formatDelta(end)})${done ? "" : " so far"}`;
  if (behind < 0) return `Your plan is ahead from the start (${formatDelta(end)})`;
  return `Your plan pulls ahead from week ${behind + 2} (${formatDelta(end)})`;
}

export interface ProfitChartProps {
  u1: TickEventData[];
  u2: TickEventData[];
  weeks: number;
  week: number;
  markers: MarkerData[];
  onSeek(week: number): void;
}

/** Cumulative gross profit, plan (solid indigo) vs do nothing (dashed grey), with end labels, a bracket, pins and a playhead. */
export function ProfitChart({ u1, u2, weeks, week, markers, onSeek }: ProfitChartProps) {
  const n = Math.min(u1.length, u2.length);
  const geo = useMemo(() => {
    const a = u1.slice(0, n).map((t) => t.cum_profit[0]);
    const b = u2.slice(0, n).map((t) => t.cum_profit[0]);
    const all = [0, ...a, ...b];
    const [lo, hi] = niceRange(Math.min(...all), Math.max(...all));
    const x = (w: number) => M.l + (w / Math.max(1, weeks - 1)) * (CW - M.l - M.r);
    const y = (v: number) => M.t + (1 - (v - lo) / (hi - lo)) * (CH - M.t - M.b);
    return { a, b, lo, hi, x, y };
  }, [u1, u2, n, weeks]);
  if (n === 0) return <div className="rp-chart empty">Simulating this plan week by week…</div>;
  const { a, b, x, y, lo, hi } = geo;
  const path = (v: number[]) => v.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d).toFixed(1)}`).join(" ");
  const ei = n - 1;
  const ya = y(a[ei]);
  const yb = y(b[ei]);
  const diff = a[ei] - b[ei];
  const wk = Math.min(week, ei);
  const ticks = [lo, (lo + hi) / 2, hi];
  const byWeek: Record<number, string[]> = {};
  markers.forEach((m) => (byWeek[m.week] = [...(byWeek[m.week] ?? []), m.text]));
  const bx = x(ei) + 10;
  // keep the two end labels from overlapping
  const gap = Math.abs(ya - yb);
  const nudge = gap < 16 ? (16 - gap) / 2 : 0;
  const topIsA = ya <= yb;
  return (
    <div className="rp-chart">
      <svg viewBox={`0 0 ${CW} ${CH}`} role="img" aria-label="Cumulative gross profit, plan versus doing nothing">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={M.l} x2={CW - M.r} y1={y(t)} y2={y(t)} stroke="var(--line)" />
            <text x={M.l + 2} y={y(t) - 3} fontSize="10.5" fill="var(--ink-3)" textAnchor="start" className="num" opacity={i === 1 ? 0 : 1}>
              {formatMoney(t)}
            </text>
          </g>
        ))}
        {lo < 0 && hi > 0 && <line x1={M.l} x2={CW - M.r} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" />}
        <path d={path(b)} fill="none" stroke="var(--rule)" strokeWidth="2" strokeDasharray="5 5" />
        <path d={path(a)} fill="none" stroke="var(--firm-a)" strokeWidth="2.5" strokeLinejoin="round" />
        {/* bracket between the two end values */}
        {Math.abs(ya - yb) > 6 && (
          <path d={`M${bx},${ya} h6 V${yb} h-6`} fill="none" stroke={diff >= 0 ? "var(--gain)" : "var(--loss)"} strokeWidth="1.5" />
        )}
        <text x={bx + 12} y={(topIsA ? ya - nudge : ya + nudge) + 4} fontSize="12.5" fontWeight="600" fill="var(--firm-a)" className="num">
          Plan {formatMoney(a[ei])}
        </text>
        <text x={bx + 12} y={(topIsA ? yb + nudge : yb - nudge) + 4} fontSize="12.5" fontWeight="500" fill="var(--ink-3)" className="num">
          Do nothing {formatMoney(b[ei])}
        </text>
        {Math.abs(ya - yb) > 40 && (
          <text x={bx + 12} y={(ya + yb) / 2 + 4} fontSize="12" fontWeight="600" fill={diff >= 0 ? "var(--gain)" : "var(--loss)"} className="num">
            {formatDelta(diff)}
          </text>
        )}
        {/* playhead */}
        <line x1={x(wk)} x2={x(wk)} y1={M.t - 4} y2={CH - M.b} stroke="var(--ink)" strokeWidth="1" opacity="0.55" />
        <circle cx={x(wk)} cy={y(a[wk])} r="4.5" fill="var(--firm-a)" stroke="var(--bg-card)" strokeWidth="2" />
        <circle cx={x(wk)} cy={y(b[wk])} r="3.5" fill="var(--rule)" stroke="var(--bg-card)" strokeWidth="2" />
        {/* x axis */}
        {[0, 6, 12, 18, weeks - 1].map((w) => (
          <text key={w} x={x(w)} y={CH - 6} fontSize="10.5" fill="var(--ink-3)" textAnchor="middle" className="num">
            {w === 0 ? "Wk 1" : w + 1}
          </text>
        ))}
        {/* click to scrub */}
        <rect
          x={M.l}
          y={0}
          width={CW - M.l - M.r}
          height={CH}
          fill="transparent"
          style={{ cursor: "pointer" }}
          onClick={(e) => {
            const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
            onSeek(Math.round(((e.clientX - r.left) / r.width) * (weeks - 1)));
          }}
        />
      </svg>
      <div className="rp-pins" aria-label="Events">
        {Object.entries(byWeek).map(([w, texts]) => {
          const wn = Number(w);
          return (
            <button
              key={w}
              className={`rp-pin${wn <= week ? " hit" : ""}`}
              style={{ left: `${(x(wn) / CW) * 100}%` }}
              title={texts.join(" · ")}
              onClick={() => onSeek(wn)}
            >
              <i />
              {wn + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
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
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="var(--line)" />
        {series.map((s) => {
          let d = "";
          s.values.forEach((v, i) => {
            if (v == null || !Number.isFinite(v)) return;
            d += `${d && s.values[i - 1] != null ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
          });
          return <path key={s.label} d={d} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "5 4" : undefined} strokeLinejoin="round" />;
        })}
        <line x1={x(week)} x2={x(week)} y1={pad.t - 4} y2={H - pad.b} stroke="var(--ink)" opacity="0.5" />
        <text x={pad.l} y={H - 4} fontSize="10" fill="var(--ink-3)">Wk 1</text>
        <text x={W - pad.r} y={H - 4} fontSize="10" fill="var(--ink-3)" textAnchor="end">{weeks}</text>
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
          { label: `${you} price`, color: "var(--firm-a)", values: col((t) => t.price[0]) },
          { label: `${rival} price`, color: "var(--firm-b)", values: col((t) => t.price[1]) },
          { label: "Your cost", color: "var(--ink-3)", values: col((t) => t.unit_cost[0]), dashed: true },
        ]}
      />
      <MiniLine
        title="Stock on hand (weeks)"
        weeks={weeks}
        week={week}
        fmt={(v) => `${v.toFixed(1)} wk`}
        series={[
          { label: you, color: "var(--firm-a)", values: col((t) => t.cover_weeks[0]) },
          { label: rival, color: "var(--firm-b)", values: col((t) => t.cover_weeks[1]) },
        ]}
      />
      {hasBull && (
        <MiniLine
          title="Order swings (bullwhip)"
          weeks={weeks}
          week={week}
          fmt={(v) => `${v.toFixed(1)}×`}
          series={[
            { label: you, color: "var(--firm-a)", values: col((t) => t.bullwhip[0]) },
            { label: rival, color: "var(--firm-b)", values: col((t) => t.bullwhip[1]) },
          ]}
        />
      )}
    </div>
  );
}
