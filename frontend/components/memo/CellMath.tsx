"use client";

import type { BusinessProfile, GridCellData, ShockCase } from "../../lib/events";
import { formatDelta, formatPrice, formatRuns, formatSignedPercent } from "../../lib/format";
import { MINUS, sign } from "../flow/parts";

/** The five bridge lines in plain words; they sum to the cell's average (engine/planner.py _path_metrics). */
const BRIDGE: { key: keyof GridCellData["bridge"]; label: string; hint: string }[] = [
  { key: "cost_usd", label: "Cost per unit", hint: "what you pay per unit vs doing nothing, on the units you sell" },
  { key: "price_usd", label: "Your price", hint: "the price gap vs doing nothing, on the units you sell" },
  { key: "volume_usd", label: "Units sold", hint: "units won or lost, at doing nothing's margin" },
  { key: "marketing_usd", label: "Marketing", hint: "extra spend (negative) or savings" },
  { key: "holding_usd", label: "Storage", hint: "cost of holding extra stock" },
];

/** "+7.5%": one decimal, so 30% × 25% doesn't round away from the memo's cost line */
const pct1 = (x: number) => {
  const v = Math.round(x * 1000) / 10;
  return `${v < 0 ? MINUS : "+"}${Math.abs(v)}%`;
};

/** How one cell of the comparison table was computed, using only the engine's own numbers. */
export function CellMath({ cell, shock, profile, onClose }: { cell: GridCellData; shock: ShockCase; profile: BusinessProfile | null; onClose: () => void }) {
  const exposed = profile?.exposed_cost_share ?? 1;
  const costMove = shock.delta_c_raw * exposed;
  const bmax = Math.max(1, ...BRIDGE.map((b) => Math.abs(cell.bridge[b.key])));
  const other = [
    shock.demand_shock !== 0 && `demand ${formatSignedPercent(shock.demand_shock)}`,
    shock.rival_price_change_pct !== 0 && `rival price ${formatSignedPercent(shock.rival_price_change_pct / 100)}`,
    shock.delta_lead_time !== 0 && `deliveries ${shock.delta_lead_time > 0 ? "+" : ""}${shock.delta_lead_time} wk`,
    shock.share_shift_pct !== 0 && `new player takes ${Math.abs(shock.share_shift_pct)}% of shoppers`,
  ].filter((x): x is string => Boolean(x));

  return (
    <div className="am-math" role="region" aria-label={`How ${cell.plan_name} in ${shock.label} was computed`}>
      <div className="am-math-head">
        <b>
          How this was computed: <em>{cell.plan_name}</em> · {shock.label}
        </b>
        <button type="button" className="am-math-x" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>

      <ol className="am-math-steps">
        <li>
          <span className="am-math-n">1</span>
          <div>
            <h4>The future sets your cost</h4>
            {shock.cost_path?.length ? (
              <code>your cost in week t = c₀ × (1 + {Math.round(exposed * 100)}% × real price change in week t)</code>
            ) : (
            <code>
              your cost = c₀ × (1 + share × change) = {profile ? formatPrice(profile.unit_cost) : "c₀"} × (1 + {Math.round(exposed * 100)}% × {formatSignedPercent(shock.delta_c_raw)}) → <b>{pct1(costMove)}</b>
            </code>
            )}
            <p>
              {shock.cost_path?.length
                ? "Only the share of your cost the news touches moves, week by week along the price that really happened."
                : `Only the share of your cost the news touches moves. It starts in week ${shock.onset_week + 1}, phases in over ${shock.ramp_weeks} ${shock.ramp_weeks === 1 ? "week" : "weeks"}, and each run scales it 0.8–1.2×.`}
              {other.length > 0 && ` This future also has ${other.join(", ")}.`}
            </p>
          </div>
        </li>
        <li>
          <span className="am-math-n">2</span>
          <div>
            <h4>Every week of every run</h4>
            <code>profit = (price − cost) × units sold − marketing − storage</code>
            <p>Units sold come from a choice model of 12 kinds of shopper picking you, the rival or nobody, with weekly noise. Nemotron sets how each kind feels; the engine does the counting.</p>
          </div>
        </li>
        <li>
          <span className="am-math-n">3</span>
          <div>
            <h4>Compare with doing nothing, on the same futures</h4>
            <code>Δ = Σ weeks profit(plan) − Σ weeks profit(do nothing)</code>
            <p>Both run on identical random draws (common random numbers), so the gap is the plan, not luck. This is repeated {formatRuns(cell.n)} times{cell.source === "cloud" ? " on a Nebius job" : ""}.</p>
          </div>
        </li>
      </ol>

      <div className="am-math-bridge">
        <h4>Where the {formatDelta(cell.mean_delta_usd)} comes from</h4>
        <table>
          <tbody>
            {BRIDGE.map((b) => {
              const v = cell.bridge[b.key];
              return (
                <tr key={b.key}>
                  <th scope="row">
                    {b.label}
                    <small>{b.hint}</small>
                  </th>
                  <td className="bar" aria-hidden>
                    <i className={v >= 0 ? "pos" : "neg"} style={{ width: `${(Math.abs(v) / bmax) * 50}%`, [v >= 0 ? "left" : "right"]: "50%" }} />
                  </td>
                  <td className={`v ${sign(v)}`}>{formatDelta(v)}</td>
                </tr>
              );
            })}
            <tr className="tot">
              <th scope="row">Average gain vs doing nothing</th>
              <td />
              <td className={`v ${sign(cell.mean_delta_usd)}`}>{formatDelta(cell.mean_delta_usd)}</td>
            </tr>
          </tbody>
        </table>
        <p className="am-math-stats">
          Bad case (worst 1 run in 20): <b className={sign(cell.p5_delta_usd)}>{formatDelta(cell.p5_delta_usd)}</b> · beats doing nothing in <b>{Math.round(cell.p_better * 100)}%</b> of {formatRuns(cell.n)} runs
        </p>
      </div>
    </div>
  );
}
