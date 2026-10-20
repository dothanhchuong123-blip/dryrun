"use client";

import { useState } from "react";
import { PixelFace } from "../faces/PixelFace";
import { formatDelta, formatMoney, formatPercent, formatSignedPercent } from "../../lib/format";
import { shopperOf } from "../../lib/faces";
import { cellKey, useMarketStore } from "../../lib/store";
import { TwinScene } from "./TwinScene";
import { AnalystCharts, chartTitle } from "./ReplayCharts";
import { WeekStrip } from "./WeekStrip";
import "./replay.css";

/** scoreboard money: always one decimal so the two totals line up ("$10.0k" next to "$10.2k") */
const money1 = (x: number) => (Math.abs(x) >= 1000 ? `${x < 0 ? "−" : ""}$${(Math.abs(x) / 1000).toFixed(1)}k` : formatMoney(x));

const FACE_SHOPPER = shopperOf({ id: 4, label: "Mid-income" });

/**
 * Replay drawer content (DESIGN §12.6): header, scoreboard, two pixel worlds (do nothing / the plan), the story line, the week strip, the end card; or the Analyst view tab.
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
  const gapNow = u1 && u2 ? u1.profit[0] - u2.profit[0] : 0;

  // story line: this week's markers, else the latest earlier one
  const here = r.markers.filter((m) => m.week === r.week);
  const earlier = [...r.markers].filter((m) => m.week < r.week).pop();
  let capText = "Both shops are calm. Nothing has hit yet.";
  let capWeek = 0;
  if (r.status === "loading") capText = "Simulating this run week by week…";
  else if (here.length) {
    capText = here.map((m) => m.text).join(" · ");
    capWeek = here[0].week;
  } else if (earlier) {
    capText = earlier.text;
    capWeek = earlier.week;
  } else capWeek = r.week;

  const same =
    !!u1 &&
    !!u2 &&
    u1.shares.every((v, i) => Math.abs(v - u2.shares[i]) < 0.005) &&
    ([0, 1] as const).every((i) => Math.abs(u1.price[i] - u2.price[i]) < 0.005 && Math.abs(u1.cover_weeks[i] - u2.cover_weeks[i]) < 0.05 && (u1.unmet[i] > 0.5) === (u2.unmet[i] > 0.5));

  // what is going on in the world (all from the ticks): input cost vs week 0, lead time, rival price
  const first = r.u1[0];
  const chips: string[] = [];
  if (u1 && first) {
    const c = first.c_raw > 0 ? u1.c_raw / first.c_raw - 1 : 0;
    chips.push(Math.abs(c) < 0.005 ? "Input cost flat" : `Input cost ${formatSignedPercent(c)}`);
    chips.push(`Lead time ${Math.round(u1.lead_time)} wk`);
    const rp = first.price[1] > 0 ? u1.price[1] / first.price[1] - 1 : 0;
    if (Math.abs(rp) >= 0.005) chips.push(`Rival price ${formatSignedPercent(rp)}`);
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
          <div className="rp-over">ONE RUN, TWO FUTURES</div>
          <h2>{r.planName}</h2>
          {r.shockLabel && <div className="rp-future">{r.shockLabel}</div>}
          {cell && (
            <div className="rp-avg" title="The grid and the memo quote the average over every run; this replay is one of them.">
              one sample run · the average of {cell.n.toLocaleString("en-US")} runs is <b>{formatDelta(cell.mean_delta_usd)}</b>
            </div>
          )}
        </div>
        <div className="rp-ctl">
          <button className="rp-b" onClick={() => step(-1)} aria-label="Previous week" title="Previous week (←)">←</button>
          <button className="rp-b play" onClick={toggle} aria-label={r.playing ? "Pause" : "Play"} title="Play / pause (Space)">{r.playing ? "❚❚" : "▶"}</button>
          <button className="rp-b" onClick={() => step(1)} aria-label="Next week" title="Next week (→)">→</button>
          <button className={`rp-b sp${fast ? " on" : ""}`} onClick={() => setSpeed(!fast)} aria-pressed={fast} aria-label="Speed" title="Speed">
            {fast ? "2×" : "1×"}
          </button>
          <button className="rp-b" onClick={close} aria-label="Close" title="Close (Esc)">✕</button>
        </div>
        <div className="rp-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "market"} className={tab === "market" ? "on" : ""} onClick={() => setTab("market")}>Market</button>
          <button role="tab" aria-selected={tab === "analyst"} className={tab === "analyst" ? "on" : ""} onClick={() => setTab("analyst")}>Analyst view</button>
        </div>
      </div>

      {r.status === "error" && <div className="rp-err">{r.error ?? "The replay stopped."}</div>}

      <div className="rp-body">
        {tab === "market" ? (
          <>
            <div className="rp-score" aria-live="polite">
              <div className="sb">
                <small>DO NOTHING</small>
                <b>{u2 ? money1(u2.cum_profit[0]) : "–"}</b>
              </div>
              <div className="sb you">
                <small>WITH THE PLAN</small>
                <b>{u1 ? money1(u1.cum_profit[0]) : "–"}</b>
              </div>
              <div className={`sb gap ${delta >= 0 ? "pos" : "neg"}`}>
                <small>GAP</small>
                <b>{u1 && u2 ? formatDelta(delta) : "–"}</b>
              </div>
              <div className="wkt">WEEK {Math.min(r.week + 1, r.weeks)} / {r.weeks}</div>
            </div>

            <div className="rp-twins">
              <TwinScene tick={u2} title="DO NOTHING" kind="none" you={you} rival={rival} />
              <TwinScene tick={u1} title="WITH THE PLAN" kind="plan" you={you} rival={rival} />
            </div>
            <div className="rp-meta">
              <div className="rp-chips">{chips.map((c) => <span key={c}>{c}</span>)}</div>
              {same && <span className="rp-same">SAME SO FAR</span>}
            </div>

            <div className="rp-story" role="status" aria-live="polite">
              <PixelFace shopper={FACE_SHOPPER} mood={gapNow > 0 ? 0.8 : gapNow < 0 ? -0.8 : 0} size={40} />
              <span className="px-bub">
                <b className="wkn">WK {capWeek + 1}</b> · {capText}
              </span>
            </div>

            <div className="rp-chartbox">
              <div className="rp-ctitle">{chartTitle(r.u1, r.u2, r.status === "done")}</div>
              <WeekStrip u1={r.u1} u2={r.u2} weeks={r.weeks} week={r.week} markers={r.markers} onSeek={seek} />
            </div>

            {last && r.cumProfit && (
              <div className="rp-done">
                <p>
                  In this run the plan made <b className={r.cumProfit.U1 - r.cumProfit.U2 >= 0 ? "pos" : "neg"}>{formatDelta(r.cumProfit.U1 - r.cumProfit.U2)}</b>{" "}
                  {r.cumProfit.U1 - r.cumProfit.U2 >= 0 ? "more" : "less"} than doing nothing.
                </p>
                {cell && (
                  <p className="all">
                    Across {cell.n.toLocaleString("en-US")} runs: average <b>{formatDelta(cell.mean_delta_usd)}</b>, {formatPercent(cell.p_better, 0)} beat doing nothing.
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <AnalystCharts u1={r.u1} weeks={r.weeks} week={r.week} you={you} rival={rival} />
        )}
      </div>
    </div>
  );
}

export default ReplayDrawer;
