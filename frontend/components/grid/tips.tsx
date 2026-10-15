"use client";

import type { CrowdArchetype, GridCellData, ShockCase } from "../../lib/events";
import { formatDelta, formatMoney, formatPercent, formatRuns } from "../../lib/format";

const LIKELY: Record<ShockCase["likelihood"], string> = { likely: "Likely", possible: "Possible", unlikely: "Unlikely" };
export const likelihoodLabel = (l: ShockCase["likelihood"]) => LIKELY[l];

const signClass = (x: number) => (Math.round(x) === 0 ? "" : x > 0 ? "pos" : "neg");

/** One diverging bar, centred on zero. `max` is the largest absolute value on the same scale. */
function DivBar({ v, max }: { v: number; max: number }) {
  const w = max > 0 ? Math.min(50, (Math.abs(v) / max) * 50) : 0;
  return (
    <span className="pg-div" aria-hidden>
      <i className={v >= 0 ? "pos" : "neg"} style={v >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }} />
    </span>
  );
}

/** The cell tooltip: summary · P&L breakdown · skill-vs-luck bar · cash. */
export function CellTipBody({
  cell,
  shock,
  rival,
  cashAvailable,
  over,
}: {
  cell: GridCellData;
  shock: ShockCase;
  rival: string;
  cashAvailable: number;
  over: boolean;
}) {
  const b = cell.bridge;
  const lines: [string, number][] = [
    ["Cheaper stock", b.cost_usd],
    ["Your price change", b.price_usd],
    ["Customers won/lost", b.volume_usd],
    ["Marketing", b.marketing_usd],
    ["Storage & money tied up", b.holding_usd],
  ];
  const max = Math.max(...lines.map(([, v]) => Math.abs(v)), Math.abs(cell.mean_delta_usd));
  const steady = cell.steady_rival_delta_usd;
  const extra = steady == null ? null : cell.mean_delta_usd - steady;
  const sw = steady == null || extra == null ? 0 : Math.abs(steady);
  const ew = extra == null ? 0 : Math.abs(extra);
  const tot = sw + ew;
  return (
    <div className="pg-tipb">
      <div className="pg-t1">
        <div className="pg-tn">
          {cell.plan_name} <span>· {shock.label}</span>
        </div>
        <div className={`pg-tmean num ${signClass(cell.mean_delta_usd)}`}>{formatDelta(cell.mean_delta_usd)}</div>
        <div className="pg-tsub">
          Average over {formatRuns(cell.n)} runs vs doing nothing. In 1 run out of 20 it's worse than{" "}
          <b className="num">{formatDelta(cell.p5_delta_usd)}</b>. Better in {formatPercent(cell.p_better, 0)} of runs.
        </div>
      </div>

      <div className="pg-t2">
        {lines.map(([label, v]) => (
          <div className="pg-bl" key={label}>
            <span>{label}</span>
            <DivBar v={v} max={max} />
            <b className={`num ${signClass(v)}`}>{formatDelta(v)}</b>
          </div>
        ))}
        <div className="pg-bl tot">
          <span>Total</span>
          <DivBar v={cell.mean_delta_usd} max={max} />
          <b className={`num ${signClass(cell.mean_delta_usd)}`}>{formatDelta(cell.mean_delta_usd)}</b>
        </div>
      </div>

      {steady != null && extra != null && (
        <div className="pg-t3">
          <div className="pg-sl" aria-hidden>
            <i className="skill" style={{ width: tot > 0 ? `${(sw / tot) * 100}%` : "100%" }} />
            <i className="luck" style={{ width: tot > 0 ? `${(ew / tot) * 100}%` : "0%" }} />
          </div>
          <div className="pg-sk">
            <i className="skill" />
            With a rival who never runs out <b className={`num ${signClass(steady)}`}>{formatDelta(steady)}</b>
          </div>
          <div className="pg-sk">
            <i className="luck" />
            Extra if {rival || "the rival"} runs short <b className={`num ${signClass(extra)}`}>{formatDelta(extra)}</b>
          </div>
        </div>
      )}

      <div className="pg-cash">
        {cell.peak_cash_usd > 0 ? (
          <>
            Cash tied up <b className="num">{formatMoney(cell.peak_cash_usd)}</b>
            {cell.payback_week != null ? ` · back by week ${cell.payback_week + 1}` : " · not back within the 24 weeks"}
          </>
        ) : (
          <>No extra cash needed</>
        )}
        {over && (
          <span className="pg-over-note">
            {" "}
            Over the {formatMoney(cashAvailable)} you could put in.
          </span>
        )}
      </div>
    </div>
  );
}

export function BaselineTipBody({ profit }: { profit: number }) {
  return (
    <div className="pg-tipb">
      <div className="pg-tsub">
        Gross profit of <b className="num">{formatMoney(profit)}</b> over the next 6 months if you change nothing. Every other cell is measured against this.
      </div>
    </div>
  );
}

export function HeaderTipBody({ shock }: { shock: ShockCase }) {
  return (
    <div className="pg-tipb">
      <div className="pg-tn">
        {shock.label} <span>· {LIKELY[shock.likelihood]}</span>
      </div>
      {shock.why && <div className="pg-tsub">{shock.why}</div>}
      {shock.cost_line && <div className="pg-tsub pg-cl">{shock.cost_line}</div>}
    </div>
  );
}

/** The two shopper reactions that say the most about a plan: the strongest pull toward or away from the user's shop. */
export function topBubbles(archetypes: CrowdArchetype[]): CrowdArchetype[] {
  return [...archetypes].sort((a, b) => Math.abs(b.mu[0]) - Math.abs(a.mu[0])).slice(0, 2);
}

export function CrowdTipBody({ plan, archetypes }: { plan: string; archetypes: CrowdArchetype[] }) {
  const top = topBubbles(archetypes);
  return (
    <div className="pg-tipb">
      <div className="pg-tn">
        How shoppers react <span>· {plan}</span>
      </div>
      {top.map((a) => (
        <div className="pg-bub" key={a.id}>
          <b>{a.label}</b>
          <span>“{a.bubble}”</span>
        </div>
      ))}
    </div>
  );
}
