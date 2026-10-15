"use client";

import { useMarketStore } from "../../lib/store";

/** STUB (F2 replaces this): the analyst log, one row per agent_step. */
export function AnalystLog() {
  const steps = useMarketStore((s) => s.agentSteps);
  const status = useMarketStore((s) => s.analysis.status);
  return (
    <div className="card slot" data-slot="AnalystLog" style={{ height: "100%" }}>
      <div className="slot-head">
        <h2>Analyst</h2>
        <span className="slot-note">AnalystLog · F2 builds this</span>
      </div>
      <div className="slot-body">
        {steps.length === 0 && <div className="empty">Nemotron will think out loud here, one row per step.</div>}
        {steps.map((r) => (
          <div key={r.seq} className={`k-${r.kind} slidein`} style={{ display: "grid", gridTemplateColumns: "76px 1fr", gap: 12, padding: "8px 0" }}>
            <span className="tag">{r.kind}</span>
            <span>{r.text}</span>
          </div>
        ))}
        {status === "running" && <div className="muted">Working…</div>}
      </div>
    </div>
  );
}

export default AnalystLog;
