/**
 * Customer mix: each shopper type's share of the market, from the profile's three dials.
 * Pure mirror of market.archetype_weights (backend/engine/market.py); profiles without the dials get the even split.
 */
import type { BusinessProfile } from "./events";
import type { Shopper } from "./faces";

export interface Mix {
  /** low, mid, high; normalised to sum 1 */
  income: [number, number, number];
  hunter: number;
  loyal: number;
}

const clip = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function mixOf(p: Pick<BusinessProfile, "income_mix" | "price_hunter_share" | "loyal_share"> | null): Mix {
  const raw = (p?.income_mix ?? []).slice(0, 3).map((x) => Math.max(0, Number(x) || 0));
  const sum = raw.reduce((a, b) => a + b, 0);
  const income = (raw.length === 3 && sum > 0 ? raw.map((x) => x / sum) : [1 / 3, 1 / 3, 1 / 3]) as Mix["income"];
  return { income, hunter: clip(p?.price_hunter_share ?? 0.5, 0.05, 0.95), loyal: clip(p?.loyal_share ?? 0.5, 0.05, 0.95) };
}

/** This shopper type's share of all buyers, 0..1. */
export function shareOf(s: Shopper, m: Mix): number {
  const inc = m.income[s.income === "Low" ? 0 : s.income === "High" ? 2 : 1];
  const hunt = s.hunter ? m.hunter : 1 - m.hunter;
  const loyal = s.loyal === "rival" ? 1 - m.loyal : s.loyal === "you" ? m.loyal : 0.5;
  return inc * hunt * loyal;
}
