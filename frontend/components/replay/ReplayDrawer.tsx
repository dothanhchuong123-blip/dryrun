"use client";

import { formatDelta, formatWeek } from "../../lib/format";
import { useMarketStore } from "../../lib/store";

/**
 * STUB (F3 replaces this): the replay drawer's content (scene, one chart, pins). The page supplies the
 * scrim, the panel and the keyboard shortcuts (Space, ←/→, Esc); this slot renders what is inside.
 */
export function ReplayDrawer() {
  const r = useMarketStore((s) => s.replay);
  const close = useMarketStore((s) => s.closeReplay);
  const toggle = useMarketStore((s) => s.toggleReplay);
  const step = useMarketStore((s) => s.stepReplay);
  const u1 = r.u1[r.week];
  const u2 = r.u2[r.week];
  return (
    <div data-slot="ReplayDrawer" style={{ padding: 22, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <h2>{r.planName}</h2>
          <div className="muted">{r.shockLabel}</div>
        </div>
        <span className="slot-note">ReplayDrawer · F3 builds this</span>
        <button className="btn ghost sm" onClick={close}>Back to grid (Esc)</button>
      </div>
      {r.status === "loading" && <div className="empty">Simulating this cell week by week…</div>}
      {u1 && u2 && (
        <>
          <div style={{ fontWeight: 600 }} className="num">
            {formatWeek(r.week, r.weeks)} · you {formatDelta(u1.cum_profit[0] - u2.cum_profit[0])} vs doing nothing
          </div>
          <div className="muted num">
            price ${u1.price[0].toFixed(2)} · stock {u1.cover_weeks[0].toFixed(1)} wk · cost/unit ${u1.unit_cost[0].toFixed(2)} · on the way {Math.round(u1.in_transit[0])}
          </div>
          <div>{r.markers.filter((m) => m.week === r.week).map((m) => m.text).join(" · ") || " "}</div>
        </>
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <button className="ib" onClick={() => step(-1)} aria-label="Previous week">←</button>
        <button className="ib play" onClick={toggle} aria-label={r.playing ? "Pause" : "Play"}>{r.playing ? "❚❚" : "▶"}</button>
        <button className="ib" onClick={() => step(1)} aria-label="Next week">→</button>
      </div>
    </div>
  );
}

export default ReplayDrawer;
