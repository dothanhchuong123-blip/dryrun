"use client";

import { useState } from "react";
import { formatDelta, formatMoney, formatWeek } from "../../lib/format";
import { cellKey, useMarketStore } from "../../lib/store";
import { MarketScene } from "./MarketScene";
import { AnalystCharts, ProfitChart, chartTitle } from "./ReplayCharts";
import "./replay.css";

const KIND_COLOR: Record<string, string> = {
  shock: "var(--loss)",
  price_change: "var(--firm-a)",
  stock_ordered: "var(--gain)",
  stock_arrives: "var(--gain)",
  sold_out: "var(--firm-b)",
  rival_move: "var(--firm-b)",
  rival_price: "var(--firm-b)",
  new_player: "var(--firm-b)",
};

/**
 * Replay drawer content: header, the market scene, a caption bar, one chart (or the Analyst view tab).
 * The page supplies the scrim, the panel and the keyboard shortcuts (Space, ←/→, Esc).
 */
export function ReplayDrawer() {
  const r = useMarketStore((s) => s.replay);
  const profile = useMarketStore((s) => s.profile);
  // the grid cell this replay came from: its average is what the grid and memo quote
  const cell = useMarketStore((s) => (s.replay.planName && s.replay.shockId ? s.cells[cellKey(s.replay.planName, s.replay.shockId)] : undefined));
  const close = useMarketStore((s) => s.closeReplay);
  const toggle = useMarketStore((s) => s.toggleReplay);
  const step = useMarketStore((s) => s.stepReplay);
  const seek = useMarketStore((s) => s.seekReplay);
  const [tab, setTab] = useState<"market" | "analyst">("market");
  const [fast, setFast] = useState(false);

  const u1 = r.u1[r.week];
  const u2 = r.u2[r.week];
  const delta = u1 && u2 ? u1.cum_profit[0] - u2.cum_profit[0] : 0;
  const last = r.u1.length > 0 && r.week >= r.u1.length - 1 && r.status === "done";
  const you = profile?.business_name ?? "You";
  const rival = profile?.rival_name ?? "Rival";

  // caption: this week's markers, else the latest earlier one
  const here = r.markers.filter((m) => m.week === r.week);
  const earlier = [...r.markers].filter((m) => m.week < r.week).pop();
  let capText = "Both shops are calm. Nothing has hit yet.";
  let capKind = "calm";
  let capWeek = 0;
  if (r.status === "loading") capText = "Simulating this cell week by week…";
  else if (here.length) {
    capText = here.map((m) => m.text).join(" · ");
    capKind = here[0].kind;
    capWeek = here[0].week;
  } else if (earlier) {
    capText = earlier.text;
    capKind = earlier.kind;
    capWeek = earlier.week;
  }
  if (last && r.cumProfit) {
    capText = `Week ${r.weeks}: plan ${formatDelta(r.cumProfit.U1 - r.cumProfit.U2)} vs doing nothing.`;
    capKind = "calm";
    capWeek = r.weeks - 1;
  }

  const setSpeed = (f: boolean) => {
    setFast(f);
    useMarketStore.setState((s) => ({ replay: { ...s.replay, weekSeconds: f ? Math.max(0.2, s.replay.weekSeconds / 2) : s.replay.weekSeconds * (fast ? 2 : 1) } }));
    if (useMarketStore.getState().replay.playing) {
      useMarketStore.getState().pauseReplay();
      useMarketStore.getState().playReplay();
    }
  };

  return (
    <div data-slot="ReplayDrawer" className="rp">
      <div className="rp-head">
        <div className="rp-title">
          <h2>
            {r.planName} <span className="muted">· {r.shockLabel ?? ""}</span>
          </h2>
          <div className="rp-sub num">
            {r.u1.length ? formatWeek(r.week, r.weeks) : "Week 1 of " + r.weeks}
            {u1 && u2 && (
              <>
                {" · "}
                <b className={delta >= 0 ? "pos" : "neg"}>{formatDelta(delta)}</b> vs doing nothing
              </>
            )}
            {cell && (
              <span className="rp-avg" title="The grid and the memo quote the average over every run; this replay is one of them.">
                {" · "}one sample run · average of {cell.n.toLocaleString("en-US")}: <b>{formatDelta(cell.mean_delta_usd)}</b>
              </span>
            )}
          </div>
        </div>
        <div className="rp-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "market"} className={tab === "market" ? "on" : ""} onClick={() => setTab("market")}>Market</button>
        <button role="tab" aria-selected={tab === "analyst"} className={tab === "analyst" ? "on" : ""} onClick={() => setTab("analyst")}>Analyst view</button>
        </div>

        <div className="rp-ctl">
          <button className="ib" onClick={() => step(-1)} aria-label="Previous week" title="Previous week (←)">←</button>
          <button className="ib play" onClick={toggle} aria-label={r.playing ? "Pause" : "Play"} title="Play / pause (Space)">{r.playing ? "❚❚" : "▶"}</button>
          <button className="ib" onClick={() => step(1)} aria-label="Next week" title="Next week (→)">→</button>
          <button className={`ib sp${fast ? " on" : ""}`} onClick={() => setSpeed(!fast)} aria-pressed={fast} aria-label="Speed" title="Speed">
            {fast ? "2×" : "1×"}
          </button>
          <button className="ib" onClick={close} aria-label="Close" title="Close (Esc)">✕</button>
        </div>
      </div>

      {r.status === "error" && <div className="rp-err">{r.error ?? "The replay stopped."}</div>}

      <div className="rp-body">
        {tab === "market" ? (
          <>
            <div className="rp-numbers num" aria-live="polite">
              {u1 && u2 ? (
                <>
                  <span><i style={{ background: "var(--firm-a)" }} /> {you} <b>{u1.price[0].toFixed(2)}</b> · stock <b>{u1.cover_weeks[0].toFixed(1)} wk</b> · cost <b>{u1.unit_cost[0].toFixed(2)}</b></span>
                  <span><i style={{ background: "var(--firm-b)" }} /> {rival} <b>{u1.price[1].toFixed(2)}</b> · stock <b>{u1.cover_weeks[1].toFixed(1)} wk</b></span>
                </>
              ) : (
                <span>Loading…</span>
              )}
            </div>
            <div className="rp-scenewrap">
              <MarketScene />
            </div>
            <div className="rp-cap" role="status">
              <span className="dot" style={{ background: KIND_COLOR[capKind] ?? "var(--ink-3)" }} />
              <span className="wk num">Wk {capWeek + 1}</span>
              <span className="txt">{capText}</span>
            </div>
            {last && r.cumProfit && (
              <div className="rp-done">
                <span>With the plan <b className="num">{formatMoney(r.cumProfit.U1)}</b> of gross profit</span>
                <span>Doing nothing <b className="num">{formatMoney(r.cumProfit.U2)}</b></span>
                <span>Difference <b className={`num ${r.cumProfit.U1 - r.cumProfit.U2 >= 0 ? "pos" : "neg"}`}>{formatDelta(r.cumProfit.U1 - r.cumProfit.U2)}</b></span>
              </div>
            )}
            <div className="rp-chartbox">
              <div className="rp-chead">
                <div className="rp-ctitle">{chartTitle(r.u1, r.u2, r.status === "done")}</div>
                <div className="rp-clegend">
                  <span><i className="solid" /> This plan</span>
                  <span><i className="dash" /> Do nothing</span>
                </div>
              </div>
              <ProfitChart u1={r.u1} u2={r.u2} weeks={r.weeks} week={r.week} markers={r.markers} onSeek={seek} />
            </div>
          </>
        ) : (
          <AnalystCharts u1={r.u1} weeks={r.weeks} week={r.week} you={you} rival={rival} />
        )}
      </div>
    </div>
  );
}

export default ReplayDrawer;
