/**
 * Pure mirror of planner._labels (backend/engine/planner.py): which plan is "Best today" and which is
 * "Safest". Used live by F2's cash slider, so it must match the backend exactly:
 *  - "Best today": highest mean_delta in the `news` column (first column if there is none), skipping plans
 *    whose cell is over the user's cash (unless every plan is). "Do nothing" when that plan's mean_delta is not
 *    above 0: no plan beats doing nothing.
 *  - "Safest": highest worst bad-case (p5) across the non-"unlikely" columns (all if every column is
 *    unlikely), skipping plans over cash in any of those columns (unless every plan is).
 *  - Ties go to the earlier plan. With no plans, both are "Do nothing".
 */
import type { GridCellData, ShockCase } from "./events";

export const DO_NOTHING = "Do nothing";

export type CellLookup = (plan: string, shock: string) => GridCellData | undefined;

/** Cell is over the user's cash. `cash <= 0` means "not given". */
export function overCash(cell: Pick<GridCellData, "peak_cash_usd">, cashAvailable: number): boolean {
  return cashAvailable > 0 && cell.peak_cash_usd > cashAvailable;
}

export function labels(
  cells: GridCellData[],
  shocks: Pick<ShockCase, "id" | "likelihood">[],
  cashAvailable: number,
): { bestToday: string; safest: string } {
  const planNames: string[] = [];
  for (const c of cells) if (!planNames.includes(c.plan_name)) planNames.push(c.plan_name);
  if (planNames.length === 0 || shocks.length === 0) return { bestToday: DO_NOTHING, safest: DO_NOTHING };

  const map = new Map<string, GridCellData>();
  for (const c of cells) map.set(`${c.plan_name}|${c.shock_id}`, c);
  const cell = (p: string, s: string) => map.get(`${p}|${s}`);
  const over = (p: string, s: string) => {
    const c = cell(p, s);
    return c ? overCash(c, cashAvailable) : false;
  };

  const newsId = shocks.find((s) => s.id === "news")?.id ?? shocks[0].id;
  const notUnlikely = shocks.filter((s) => s.likelihood !== "unlikely").map((s) => s.id);
  const safeIds = notUnlikely.length ? notUnlikely : shocks.map((s) => s.id);

  // argmax with ties to the earlier plan
  const argmax = (pool: string[], score: (p: string) => number): string => {
    let best = pool[0];
    let bestScore = score(best);
    for (const p of pool.slice(1)) {
      const sc = score(p);
      if (sc > bestScore) {
        best = p;
        bestScore = sc;
      }
    }
    return best;
  };

  const bestPoolRaw = planNames.filter((p) => !over(p, newsId));
  const bestPool = bestPoolRaw.length ? bestPoolRaw : planNames;
  const top = argmax(bestPool, (p) => cell(p, newsId)?.mean_delta_usd ?? -Infinity);
  const bestToday = (cell(top, newsId)?.mean_delta_usd ?? -Infinity) > 0 ? top : DO_NOTHING;

  const safePoolRaw = planNames.filter((p) => !safeIds.some((s) => over(p, s)));
  const safePool = safePoolRaw.length ? safePoolRaw : planNames;
  const safest = argmax(safePool, (p) =>
    Math.min(...safeIds.map((s) => cell(p, s)?.p5_delta_usd ?? Infinity)),
  );
  return { bestToday, safest };
}
