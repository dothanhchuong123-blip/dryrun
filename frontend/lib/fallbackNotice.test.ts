/** node --experimental-strip-types --test lib/fallbackNotice.test.ts   (from frontend/) */
import assert from "node:assert/strict";
import test from "node:test";
import type { CrowdArchetype } from "./events.ts";
import { fallbackNotice, type FallbackInput } from "./fallbackNotice.ts";

const row = (id: number, ok: boolean): CrowdArchetype => ({
  id, label: `g${id}`, mu: ok ? [0.3, -0.1] : [0, 0], sigma: ok ? [0.2, 0.2] : [0.1, 0.1], bubble: ok ? "hmm" : "",
});
const rows = (missing: number, n = 12) => Array.from({ length: n }, (_, i) => row(i + 1, i >= missing));
const priced = { name: "Raise", spec: { price_change_pct: 5, marketing_change_pct: 0 } };
const stockOnly = { name: "Stock", spec: { price_change_pct: 0, marketing_change_pct: 0 } };
const base: FallbackInput = { crowdByPlan: {}, plans: [priced, stockOnly], agentSteps: [], scenarios: null, memo: null };

test("a clean run shows nothing", () => {
  assert.deepEqual(fallbackNotice({ ...base, crowdByPlan: { Raise: rows(0), Stock: rows(12) } }), []);
});
test("neutral rows of a plan shoppers can't see are not dropouts", () => {
  assert.deepEqual(fallbackNotice({ ...base, crowdByPlan: { Stock: rows(12) } }), []);
});
test("under 5% missing is hidden, 5% and over is shown", () => {
  assert.deepEqual(fallbackNotice({ ...base, crowdByPlan: { Raise: rows(1, 24) } }).length, 0);
  assert.match(fallbackNotice({ ...base, crowdByPlan: { Raise: rows(1, 12) } })[0], /1 of 12 shopper answers/);
});
test("memo first, then analyst, then shoppers", () => {
  const out = fallbackNotice({
    ...base,
    crowdByPlan: { Raise: rows(3) },
    agentSteps: [
      { kind: "fallback", round: 2, text: "Ultra did not answer twice; running a fixed search over price and stock instead." },
      { kind: "fallback", round: 4, text: "Writing the memo from a template." },
      { kind: "fallback", round: 1, text: "Skipped “X”: none known." },
      { kind: "think", round: 1, text: "ok" },
    ],
    scenarios: { fallback_used: false },
    memo: { fallback_used: true },
  });
  assert.equal(out.length, 3);
  assert.match(out[0], /template/);
  assert.match(out[1], /step 2/);
  assert.match(out[2], /3 of 12/);
});
