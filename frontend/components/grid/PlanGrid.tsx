"use client";

import { formatDelta } from "../../lib/format";
import { cellKey, useMarketStore } from "../../lib/store";
import { withTransition } from "../../lib/transition";

/** STUB (F2 replaces this): the plans × futures grid. Cell click opens the replay. */
export function PlanGrid() {
  const plans = useMarketStore((s) => s.plans);
  const shocks = useMarketStore((s) => s.shocks);
  const cells = useMarketStore((s) => s.cells);
  const summary = useMarketStore((s) => s.summary);
  const memo = useMarketStore((s) => s.memo);
  const open = useMarketStore((s) => s.openReplay);
  const setStep = useMarketStore((s) => s.setStep);
  const verify = useMarketStore((s) => s.verify);
  return (
    <div className="card slot" data-slot="PlanGrid" style={{ height: "100%" }}>
      <div className="slot-head">
        <h2>Plans × futures</h2>
        <span className="slot-note">PlanGrid · F2 builds this</span>
      </div>
      <div className="slot-body">
        {plans.length === 0 ? (
          <div className="empty">Nemotron will test plans here. Each cell = 1,000 simulated runs.</div>
        ) : (
          <table style={{ borderCollapse: "separate", borderSpacing: 4, width: "100%", fontSize: 13 }}>
            <thead>
              <tr>
                <th />
                {shocks.map((s) => (
                  <th key={s.id} style={{ textAlign: "left", color: "var(--ink-3)" }}>{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.name}>
                  <td style={{ fontWeight: 600 }}>
                    {p.name}
                    {summary?.best_today === p.name && <span className="rchip pos"> Best today</span>}
                    {summary?.safest === p.name && <span className="rchip"> Safest</span>}
                  </td>
                  {shocks.map((s) => {
                    const c = cells[cellKey(p.name, s.id)];
                    return (
                      <td key={s.id}>
                        <button
                          className="btn ghost sm num"
                          disabled={!c}
                          style={{ width: "100%", justifyContent: "flex-start", color: c ? (c.mean_delta_usd >= 0 ? "var(--gain)" : "var(--loss)") : undefined }}
                          onClick={() => void open(p.name, s.id)}
                        >
                          {c ? formatDelta(c.mean_delta_usd) : "…"}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button className="btn ghost sm" onClick={() => void verify()} disabled={plans.length === 0}>Verify on Nebius</button>
          <button className="btn sm" disabled={!memo} onClick={() => withTransition(() => setStep("memo"))}>See the memo →</button>
        </div>
      </div>
    </div>
  );
}

export default PlanGrid;
