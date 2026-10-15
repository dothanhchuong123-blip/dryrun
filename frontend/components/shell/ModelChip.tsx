"use client";

import type { ModelTier } from "../../lib/events";
import { useMarketStore } from "../../lib/store";

/** Display names. Model names stay (NVIDIA judges) but always sit next to the job they do (DESIGN §12.2). */
export const TIER_NAME: Record<ModelTier, string> = {
  ultra: "Ultra",
  super: "Super",
  fast: "Lightning",
};

/**
 * A model chip: "● Ultra · analyst". Lights up while that tier made the latest call of a running analysis.
 * Everyone uses it: `<ModelChip tier="ultra" job="analyst" />`.
 */
export function ModelChip({ tier, job }: { tier: ModelTier; job: string }) {
  const live = useMarketStore((s) => {
    if (s.analysis.status !== "running") return false;
    const last = s.agentSteps[s.agentSteps.length - 1];
    return last?.tier === tier;
  });
  const calls = useMarketStore((s) => s.telemetry?.tiers[tier].calls);
  return (
    <span
      className={`mchip t-${tier}${live ? " live" : ""}`}
      title={`Nemotron ${TIER_NAME[tier]}${calls != null ? ` · ${calls} calls this run` : ""}`}
    >
      <span className="dot" />
      {TIER_NAME[tier]} <span className="job">· {job}</span>
    </span>
  );
}

export default ModelChip;
