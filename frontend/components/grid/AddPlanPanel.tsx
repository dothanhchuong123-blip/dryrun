"use client";

import { useId, useMemo, useState } from "react";
import type { BusinessProfile, PlanSpec } from "../../lib/events";
import { formatMoney } from "../../lib/format";
import { MAX_USER_PLANS, useMarketStore } from "../../lib/store";

const sgn = (n: number) => (n < 0 ? `−${Math.abs(n)}` : n > 0 ? `+${n}` : "0");

/** "Your plan: +4% wk 2, stock 3 wk", shortened to the backend's 40-character cap. */
export function autoName(s: {
  price: number;
  week: number;
  end?: number;
  stock: number;
  supplier: boolean;
}): string {
  const parts: string[] = [];
  if (s.price !== 0) parts.push(`${sgn(s.price)}% wk ${s.week}${s.end != null && s.end < 24 && s.end > s.week ? `-${s.end}` : ""}`);
  if (s.stock > 0) parts.push(`stock ${s.stock} wk`);
  if (s.supplier) parts.push("new supplier");
  const body = parts.join(", ");
  for (const prefix of ["Your plan: ", "Yours: ", ""]) {
    if ((prefix + body).length <= 40) return prefix + body;
  }
  return body.slice(0, 40);
}

/** The "+ Add your own plan" panel: price, timing, extra stock, backup supplier. Engine only, free. */
export function AddPlanPanel({ profile, onClose }: { profile: BusinessProfile; onClose: () => void }) {
  const addPlan = useMarketStore((s) => s.addPlan);
  const userPlans = useMarketStore((s) => s.plans.filter((p) => p.source === "user").length);
  const [price, setPrice] = useState(4);
  const [week, setWeek] = useState(2);
  const [end, setEnd] = useState(24); // 24 = the change stays to the end
  const [stock, setStock] = useState(3);
  const [supplier, setSupplier] = useState(false);
  const [altCost, setAltCost] = useState(8);
  const [altLead, setAltLead] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uid = useId();

  const endWeek = end > week ? end : 24;
  const name = autoName({ price, week, end: endWeek, stock, supplier });
  const upfront = stock * profile.weekly_sales * profile.unit_cost;
  const over = profile.cash_available > 0 && upfront > profile.cash_available;
  const nothing = price === 0 && stock === 0 && !supplier;
  const full = userPlans >= MAX_USER_PLANS;

  const spec = useMemo<PlanSpec>(
    () => ({
      name,
      price_change_pct: price,
      price_change_week: week,
      price_end_week: endWeek,
      extra_stock_weeks: stock,
      stock_week: 0,
      marketing_change_pct: 0,
      switch_supplier: supplier,
      alt_cost_change_pct: altCost,
      alt_lead_time_weeks: altLead,
      alt_shock_exposure: 0.3,
    }),
    [name, price, week, endWeek, stock, supplier, altCost, altLead],
  );

  const submit = async () => {
    setBusy(true);
    setError(null);
    const err = await addPlan(spec);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };

  return (
    <div className="card pg-add" role="dialog" aria-label="Add your own plan">
      <div className="pg-addh">
        <h3>
          Your plan: <span className="pg-pname">{name.replace(/^(Your plan|Yours): /, "") || "no changes yet"}</span>
        </h3>
        <button type="button" className="al-tbtn pg-close" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="pg-sl">
        <label htmlFor={`${uid}p`}>Price change</label>
        <input id={`${uid}p`} type="range" min={-20} max={20} step={1} value={price} onChange={(e) => setPrice(+e.target.value)} />
        <output className="num">{price === 0 ? "none" : `${sgn(price)}%`}</output>
      </div>
      <div className="pg-sl">
        <label htmlFor={`${uid}w`}>From week</label>
        <input id={`${uid}w`} type="range" min={0} max={23} step={1} value={week} disabled={price === 0} onChange={(e) => setWeek(+e.target.value)} />
        <output className="num">{price === 0 ? "–" : `week ${week}`}</output>
      </div>
      <div className="pg-sl">
        <label htmlFor={`${uid}e`}>Ends in week</label>
        <input id={`${uid}e`} type="range" min={week + 1} max={24} step={1} value={Math.max(end, week + 1)} disabled={price === 0} onChange={(e) => setEnd(+e.target.value)} />
        <output className="num">{price === 0 || endWeek >= 24 ? "stays" : `week ${endWeek}`}</output>
      </div>
      <div className="pg-sl">
        <label htmlFor={`${uid}s`}>Extra stock</label>
        <input id={`${uid}s`} type="range" min={0} max={8} step={1} value={stock} onChange={(e) => setStock(+e.target.value)} />
        <output className="num">{stock === 0 ? "none" : `${stock} wk`}</output>
      </div>
      {stock > 0 && (
        <div className="pg-upfront">
          Needs about <b className="num">{formatMoney(upfront)}</b> of cash up front
          {over && <span className="pg-over">Over your cash</span>}
        </div>
      )}
      <div className="pg-sl">
        <label htmlFor={`${uid}x`}>Switch supplier</label>
        <label className="pg-chk">
          <input id={`${uid}x`} type="checkbox" checked={supplier} onChange={(e) => setSupplier(e.target.checked)} />
          {supplier ? "On" : "Off"}
        </label>
        <span />
      </div>
      {supplier && (
        <>
          <div className="pg-sl">
            <label htmlFor={`${uid}c`}>Their cost vs now</label>
            <input id={`${uid}c`} type="range" min={-30} max={50} step={1} value={altCost} onChange={(e) => setAltCost(+e.target.value)} />
            <output className="num">{altCost === 0 ? "same" : `${sgn(altCost)}%`}</output>
          </div>
          <div className="pg-sl">
            <label htmlFor={`${uid}l`}>Their lead time</label>
            <input id={`${uid}l`} type="range" min={1} max={16} step={1} value={altLead} onChange={(e) => setAltLead(+e.target.value)} />
            <output className="num">{altLead} wk</output>
          </div>
        </>
      )}

      <div className="pg-addf">
        <span className="muted pg-note">
          {full
            ? `You can add up to ${MAX_USER_PLANS} plans of your own, so the grid stays quick and readable.`
            : nothing
              ? "Change at least one thing to test it."
              : `Engine only: free, about 1 s, no Nemotron call. ${userPlans} of ${MAX_USER_PLANS} own plans used.`}
        </span>
        <button type="button" className="btn sm pg-go" disabled={busy || full || nothing} onClick={() => void submit()}>
          {busy ? "Adding…" : "Test this plan"}
        </button>
      </div>
      {error && (
        <div className="neg" role="alert" style={{ fontSize: 13 }}>
          {error}
        </div>
      )}
    </div>
  );
}
