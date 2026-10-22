/**
 * F6: how much of a finished run fell back to the built-in rules, counted from events the run already sent.
 * Pure, so it can be checked without a browser: node --experimental-strip-types --test lib/fallbackNotice.test.ts
 */
import type { AgentStepData, CrowdArchetype, MemoEventData, PlanSpec, ScenariosEventData } from "./events.ts";

/** Hide the shopper line below this share of missing answers: old recordings have a few dropouts, and that's normal. */
export const SHOPPER_NOTICE_SHARE = 0.05;

export interface FallbackInput {
  crowdByPlan: Record<string, CrowdArchetype[]>;
  /** shoppers only see a price or marketing change; any other plan gets neutral rows without a call */
  plans: { name: string; spec: Pick<PlanSpec, "price_change_pct" | "marketing_change_pct"> }[];
  agentSteps: Pick<AgentStepData, "kind" | "round" | "text">[];
  scenarios: Pick<ScenariosEventData, "fallback_used"> | null;
  memo: Pick<MemoEventData, "fallback_used"> | null;
}

/** The neutral row the backend sends for a shopper group that never answered (mu 0, empty bubble). */
export const isMissingShopper = (r: CrowdArchetype): boolean =>
  r.bubble === "" && r.mu[0] === 0 && r.mu[1] === 0;

/** Lines for the Answer step, most serious first: memo, then analyst, then shoppers. Empty when nothing fell back. */
export function fallbackNotice(x: FallbackInput): string[] {
  const lines: string[] = [];
  if (x.memo?.fallback_used) lines.push("This memo was written from a template, not by Nemotron Ultra.");

  // only the step where Ultra failed and the fixed search took over; other "fallback" rows are small notes
  const rounds = [...new Set(x.agentSteps.filter((s) => s.kind === "fallback" && s.round > 0 && s.text.startsWith("Ultra did not answer")).map((s) => s.round))];
  if (x.scenarios?.fallback_used) lines.push("The analyst used some standard futures instead of its own.");
  for (const r of rounds.sort((a, b) => a - b)) lines.push(`The analyst's step ${r} used the built-in plans.`);

  const seen = new Set(x.plans.filter((p) => p.spec.price_change_pct !== 0 || p.spec.marketing_change_pct !== 0).map((p) => p.name));
  let total = 0, missing = 0;
  for (const [name, rows] of Object.entries(x.crowdByPlan)) {
    if (!seen.has(name)) continue;
    total += rows.length;
    missing += rows.filter(isMissingShopper).length;
  }
  if (total > 0 && missing / total >= SHOPPER_NOTICE_SHARE) {
    lines.push(`Nemotron was slow on this run: ${missing} of ${total} shopper answers were missing and counted as neutral.`);
  }
  return lines;
}
