/**
 * labels() must agree with planner._labels. Fixture: frontend/mock/labels_fixture.json, written by
 * scripts/make_mock_stream.py from the real planner at several cash levels.
 *
 *   node --experimental-strip-types --test lib/labels.test.ts   (from frontend/)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { GridCellData } from "./events.ts";
import { labels, overCash } from "./labels.ts";

const fx = JSON.parse(readFileSync(new URL("../mock/labels_fixture.json", import.meta.url), "utf8")) as {
  shocks: { id: string; likelihood: "likely" | "possible" | "unlikely" }[];
  cells: GridCellData[];
  expected: { cash_available: number; best_today: string; safest: string }[];
};

for (const e of fx.expected) {
  test(`labels match planner._labels at cash ${e.cash_available}`, () => {
    const got = labels(fx.cells, fx.shocks, e.cash_available);
    assert.equal(got.bestToday, e.best_today);
    assert.equal(got.safest, e.safest);
  });
}

test("overCash: 0 means not given", () => {
  assert.equal(overCash({ peak_cash_usd: 9000 }, 0), false);
  assert.equal(overCash({ peak_cash_usd: 9000 }, 8000), true);
  assert.equal(overCash({ peak_cash_usd: 8000 }, 8000), false);
});

test("no plans → Do nothing", () => {
  assert.deepEqual(labels([], fx.shocks, 0), { bestToday: "Do nothing", safest: "Do nothing" });
});

test("ties go to the earlier plan", () => {
  const mk = (plan: string): GridCellData => ({ ...fx.cells[0], plan_name: plan, shock_id: "news", mean_delta_usd: 100, p5_delta_usd: 10, peak_cash_usd: 0, over_cash: false });
  const got = labels([mk("A"), mk("B")], [{ id: "news", likelihood: "likely" }], 0);
  assert.equal(got.bestToday, "A");
  assert.equal(got.safest, "A");
});
