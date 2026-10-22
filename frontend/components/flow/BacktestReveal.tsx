"use client";

import type { BacktestEventData } from "../../lib/events";
import { formatDelta, formatMoney } from "../../lib/format";
import { useMarketStore } from "../../lib/store";
import { EngineOnly, MINUS, sign } from "./parts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2024-04-15" -> "15 Apr 2024" ("2024-05" -> "May 2024") */
function niceDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  const month = MONTHS[Number(m) - 1];
  if (!month) return iso;
  return d ? `${Number(d)} ${month} ${y}` : `${month} ${y}`;
}
const shortDate = (iso: string) => niceDate(iso).replace(/ \d{4}$/, "");

/** a change as "+121%" / "−9%" */
const pct = (x: number) => `${x < 0 ? MINUS : "+"}${Math.abs(Math.round(x * 100))}%`;

/** "$9.74/kg" for a "$/kg" series, "145 %" for a plain one */
function showValue(v: number, unit: string): string {
  const n = Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2);
  return unit.startsWith("$") ? `$${n}${unit.slice(1)}` : `${n} ${unit}`;
}

// ---- the price line -----------------------------------------------------------------------------

const W = 640;
const H = 250;
const PAD = { l: 46, r: 16, t: 16, b: 30 };

function niceStep(span: number): number {
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
}

function PriceLine({ b }: { b: BacktestEventData }) {
  const pts = b.series.points;
  const cover = b.futures_cover;
  const ys = pts.map((p) => p.change);
  const lo0 = Math.min(0, ...ys, cover.min);
  const hi0 = Math.max(0, ...ys, cover.max);
  const step = niceStep(Math.max(0.2, hi0 - lo0));
  const lo = Math.floor(lo0 / step) * step;
  const hi = Math.ceil(hi0 / step) * step;
  const x = (week: number) => PAD.l + (week / 24) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const ticks: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  const peak = pts.reduce((a, p) => (p.change > a.change ? p : a), pts[0]);
  const last = pts[pts.length - 1];
  const line = pts.map((p) => `${x(p.week).toFixed(1)},${y(p.change).toFixed(1)}`).join(" ");
  const bandTop = y(Math.max(cover.max, cover.min));
  const bandBottom = y(Math.min(cover.max, cover.min));
  const xLabels = [pts[0], pts[Math.floor(pts.length / 2)], last].filter(Boolean);
  const label = (p: (typeof pts)[number], dy: number) => ({ x: Math.min(W - PAD.r - 2, Math.max(PAD.l + 2, x(p.week))), y: y(p.change) + dy });
  const peakAt = label(peak, peak.change >= last.change ? -9 : 15);
  return (
    <svg className="bt-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${b.series.label} over the 24 weeks after ${niceDate(b.as_of)}`}>
      {ticks.map((t) => (
        <g key={t}>
          <line className={t === 0 ? "zero" : "grid"} x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
          <text className="ax" x={PAD.l - 6} y={y(t) + 4} textAnchor="end">
            {t === 0 ? "0%" : pct(t)}
          </text>
        </g>
      ))}
      <rect className="band" x={PAD.l} y={bandTop} width={W - PAD.l - PAD.r} height={Math.max(2, bandBottom - bandTop)} />
      <text className="bandl" x={W - PAD.r - 4} y={bandTop + 12} textAnchor="end">
        what the AI planned for
      </text>
      <line className="asof" x1={x(0)} x2={x(0)} y1={PAD.t} y2={H - PAD.b} />
      <polyline className="ln" points={line} />
      <rect className="dot" x={x(0) - 4} y={y(0) - 4} width={8} height={8} />
      <rect className="dot hi" x={x(peak.week) - 4} y={y(peak.change) - 4} width={8} height={8} />
      <rect className="dot" x={x(last.week) - 4} y={y(last.change) - 4} width={8} height={8} />
      <text className="lab" x={peakAt.x} y={peakAt.y} textAnchor={peak.week > 18 ? "end" : "middle"}>
        {peak.week > 0 ? `peak ${pct(peak.change)}` : ""}
      </text>
      <text className="lab" x={label(last, last.change >= 0 ? 15 : -9).x} y={label(last, last.change >= 0 ? 15 : -9).y} textAnchor="end">
        {pct(last.change)} · {showValue(last.value, b.series.unit)}
      </text>
      <text className="lab asl" x={x(0) + 8} y={PAD.t + 10}>
        {shortDate(b.as_of)}: you are here
      </text>
      {xLabels.map((p, i) => (
        <text key={p.week} className="ax" x={x(p.week)} y={H - 8} textAnchor={i === 0 ? "start" : i === xLabels.length - 1 ? "end" : "middle"}>
          {shortDate(p.date)}
        </text>
      ))}
    </svg>
  );
}

// ---- the panel ----------------------------------------------------------------------------------

interface Row {
  key: string;
  name: string;
  tags: string[];
  v: number;
}

export function BacktestReveal() {
  const b = useMarketStore((s) => s.backtest);
  const openReplay = useMarketStore((s) => s.openReplay);
  const memo = useMarketStore((s) => s.memo);
  const shocks = useMarketStore((s) => s.shocks);
  if (!b) return null;

  const cover = b.futures_cover;
  const tested = b.cells.some((c) => c.plan_name === b.pick);
  const doNothing = b.pick === "Do nothing" || !tested;

  // pick, the baselines and the best plan in hindsight; one row per plan name
  const rows: Row[] = [];
  const add = (name: string, v: number, tag: string) => {
    const hit = rows.find((r) => r.name === name);
    if (hit) hit.tags.push(tag);
    else rows.push({ key: name, name, tags: [tag], v });
  };
  add(b.pick, b.pick_delta_usd, "The memo's pick");
  for (const base of b.baselines) add(base.name, base.mean_delta_usd, base.name === "Do nothing" ? "Baseline" : "Baseline");
  add(b.hindsight_best.name, b.hindsight_best.mean_delta_usd, "Best in hindsight");
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.v)));

  const d = b.pick_delta_usd;
  const verdictCls = doNothing ? "" : sign(d);
  const verdict = doNothing
    ? "The memo said to hold steady, so it matched doing nothing."
    : d > 0
      ? `The memo's plan made ${formatMoney(d)} more than doing nothing.`
      : d < 0
        ? `The memo's plan lost ${formatMoney(Math.abs(d))} vs doing nothing.`
        : "The memo's plan matched doing nothing.";
  const rank = `It ranked ${b.pick_rank} of ${b.n_plans} on the real path (counting doing nothing).`;
  const hind =
    b.regret_usd > 0
      ? `Best plan in hindsight: ${b.hindsight_best.plain || b.hindsight_best.name} (${formatMoney(b.regret_usd)} more).`
      : "The memo's pick was also the best plan in hindsight.";
  // the memo's headline is a forecast for one tested future; this panel is the same plan on the real path
  const forecast = memo && !doNothing && memo.plan_name === b.pick ? memo.numbers : null;
  const forecastIn = forecast && shocks.find((s) => s.id === forecast.shock_id)?.label;

  // the peak and end are read off the line above, so the words match the chart
  const pts = b.series.points;
  const peakChange = Math.max(...pts.map((p) => p.change));
  const endChange = pts[pts.length - 1].change;
  const within = (v: number) => v >= Math.min(cover.min, cover.max) - 1e-9 && v <= Math.max(cover.min, cover.max) + 1e-9;
  const allInside = within(peakChange) && within(endChange);
  const inside = (v: number) => (within(v) ? "inside" : "outside");
  const coverText = `The futures we tested ranged from ${pct(cover.min)} to ${pct(cover.max)}. Reality peaked at ${pct(peakChange)} (${inside(peakChange)}) and ended at ${pct(endChange)} (${inside(endChange)}).`;

  return (
    <section className="bt" aria-labelledby="bt-h">
      <header className="bt-head">
        <span className="bt-eyebrow">What actually happened</span>
        <h2 id="bt-h">
          {niceDate(b.as_of)} to {niceDate(b.horizon_end)}
        </h2>
        <p className="bt-sub">
          The memo above only used news from before {niceDate(b.as_of)}. Here is what the price really did, and how the advice scored on that real path.
        </p>
      </header>

      <div className="bt-verdict">
        <p className={`bt-big ${verdictCls}`}>
          {verdict} <span className="bt-rank">{rank}</span>
        </p>
        <p className="bt-hind">{hind}</p>
        {!doNothing && b.pick_engine_only_usd != null && (
          <p className="bt-hind">
            <EngineOnly v={b.pick_engine_only_usd} long />. Most of the gap is the AI shoppers&apos; mood, which no real data checks; the simulator alone is the steadier number.
          </p>
        )}
        {forecast && (
          <p className="bt-hind">
            Why this differs from the memo&apos;s {formatDelta(forecast.mean_delta_usd)}: that was the forecast{forecastIn ? ` for “${forecastIn}”` : ""}, made on {niceDate(b.as_of)} with only the news of that day. This number is the same plan run on the price that really happened.
          </p>
        )}
      </div>

      <figure className="bt-fig">
        <figcaption>
          {b.series.label} <small>({b.series.unit}, change vs {shortDate(b.as_of)})</small>
        </figcaption>
        <PriceLine b={b} />
        <p className="bt-cover">
          <span className={`bt-tag ${allInside ? "ok" : "warn"}`}>
            {allInside ? "Reality fell inside" : "Reality fell outside"}
          </span>{" "}
          {coverText}
        </p>
        <a className="bt-src" href={b.series.source_url} target="_blank" rel="noopener noreferrer">
          Data: {b.series.label}
        </a>
      </figure>

      <div className="bt-tw">
        <table className="bt-tbl">
          <caption>Profit vs doing nothing, on the real path (average of 1,000 runs)</caption>
          <thead>
            <tr>
              <th scope="col">Plan</th>
              <th scope="col">vs do nothing</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={r.tags.includes("The memo's pick") ? "rec" : undefined}>
                <td>
                  {r.name}
                  {r.tags.map((t) => (
                    <span key={t} className={`bt-tag${t === "Baseline" ? "" : " em"}`}>
                      {t}
                    </span>
                  ))}
                </td>
                <td className={`c ${sign(r.v)}`}>
                  {formatDelta(r.v)}
                  <i style={{ background: r.v >= 0 ? "var(--fl-gain-bar)" : "var(--fl-loss-bar)", width: `calc(${(Math.abs(r.v) / max) * 100}% - 16px)`, left: r.v >= 0 ? 8 : "auto", right: r.v < 0 ? 8 : "auto" }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {b.what_happened.length > 0 && (
        <div className="bt-sec">
          <h3>Timeline</h3>
          <ol className="bt-tl">
            {b.what_happened.map((w) => (
              <li key={w.date + w.url}>
                <time>{niceDate(w.date)}</time>
                <span>
                  {w.text}{" "}
                  {/^https?:\/\//.test(w.url) && (
                    <a href={w.url} target="_blank" rel="noopener noreferrer">
                      source
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className={`bt-leak ${b.leak_check.clean ? "ok" : "warn"}`} role="status">
        {b.leak_check.clean ? (
          <b>No hindsight in the reasoning</b>
        ) : (
          <>
            <b>Possible hindsight in the reasoning ({b.leak_check.flags.length})</b>
            <ul>
              {b.leak_check.flags.map((f, i) => (
                <li key={i}>
                  <i>{f.where}:</i> {f.text}
                </li>
              ))}
            </ul>
          </>
        )}
        <small>
          We checked everything the AI wrote against words and numbers from after {niceDate(b.as_of)}.
          {b.dropped_news > 0 ? ` ${b.dropped_news} news ${b.dropped_news === 1 ? "page" : "pages"} dated too late ${b.dropped_news === 1 ? "was" : "were"} dropped before it read them.` : ""}
        </small>
      </div>

      {b.caveats.length > 0 && (
        <details className="am-fold bt-cav" open>
          <summary>Not in these numbers ({b.caveats.length})</summary>
          <ul className="am-bul warn">
            {b.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </details>
      )}

      {tested && !doNothing && (
        <div className="bt-act">
          <button type="button" className="fl-btn2" onClick={() => void openReplay(b.pick, "realized")}>
            ▶ Replay the real path
          </button>
          <span>Watch the memo&apos;s plan against {b.realized_case.label.replace(/^What happened: /, "").toLowerCase()}.</span>
        </div>
      )}
    </section>
  );
}
