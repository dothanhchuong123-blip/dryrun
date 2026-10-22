"use client";

import { useMemo } from "react";
import { fallbackNotice } from "../../lib/fallbackNotice";
import { useMarketStore } from "../../lib/store";
import "./fallbackNotice.css";

/** F6: says how much of this run Nemotron didn't write. Shows nothing when nothing fell back. */
export function FallbackNotice() {
  const crowdByPlan = useMarketStore((s) => s.crowdByPlan);
  const plans = useMarketStore((s) => s.plans);
  const agentSteps = useMarketStore((s) => s.agentSteps);
  const scenarios = useMarketStore((s) => s.scenarios);
  const memo = useMarketStore((s) => s.memo);
  const lines = useMemo(
    () => fallbackNotice({ crowdByPlan, plans, agentSteps, scenarios, memo }),
    [crowdByPlan, plans, agentSteps, scenarios, memo],
  );
  if (!lines.length) return null;
  return (
    <div className="fb-notice" role="note">
      {lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
    </div>
  );
}
