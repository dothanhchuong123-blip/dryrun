/**
 * What the plans × futures grid shows instead of walls of numbers (DESIGN.md §12.6):
 * a pixel block meter per cell and abstract tag chips per future. Everything is derived
 * from the numbers and the shock-case fields (SPEC §15.5), so futures Ultra invents at runtime still get one.
 */
import type { ShockCase } from "./events";

/** How the cell's meter looks: green blocks up (win), coral blocks down (loss), a grey dash (about even). */
export interface Meter {
  dir: "up" | "down" | "even";
  blocks: number;
}
export const METER_MAX = 5;

/** Scale for one grid: the biggest swing either way. */
export const gridMax = (deltas: number[]) => deltas.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

/**
 * Profit change vs doing nothing → meter. The only place the thresholds live:
 * - about even (|v| under $100, or under 5% of the biggest swing on the grid): one grey dash
 * - otherwise blocks = |v| ÷ biggest swing × 5, rounded, at least 1
 */
export function cellMeter(v: number, max: number): Meter {
  if (Math.abs(v) < 100 || Math.abs(v) < 0.05 * max) return { dir: "even", blocks: 0 };
  return { dir: v > 0 ? "up" : "down", blocks: Math.min(METER_MAX, Math.max(1, Math.round((Math.abs(v) / max) * METER_MAX))) };
}

/** How one plan row did across the futures: a win is a cell that is a profit by the same rule as the meter (about-even cells do not count). */
export interface Wins {
  wins: number;
  total: number;
  tone: "all" | "some" | "none";
}
export function winCount(values: number[], max: number): Wins | null {
  if (!values.length) return null;
  const wins = values.filter((v) => cellMeter(v, max).dir === "up").length;
  return { wins, total: values.length, tone: wins === values.length ? "all" : wins === 0 ? "none" : "some" };
}

/** A driver of a future, as one tag chip: "COST ▲30%", "RIVAL ▼5%", "DELAY +2 WK", "NEW RIVAL". */
export interface FutureChip {
  label: string;
  arrow: "up" | "down" | null;
  text: string;
  /** effect on the user: bad (coral), good (green), neutral (grey) */
  tone: "bad" | "good" | "neutral";
}

const n = (v: number) => `${Math.round(Math.abs(v))}%`;

/**
 * Up to two chips for a future, from its knobs (SPEC §15.5), biggest effect on the user first.
 * Falls back to one neutral chip with the label's first words when no knob moves.
 */
export function futureChips(s: ShockCase): FutureChip[] {
  const all: FutureChip[] = [];
  if (Math.abs(s.delta_c_raw) >= 0.02)
    all.push({ label: "Cost", arrow: s.delta_c_raw > 0 ? "up" : "down", text: n(s.delta_c_raw * 100), tone: s.delta_c_raw > 0 ? "bad" : "good" });
  if (s.share_shift_pct >= 1) all.push({ label: "New rival", arrow: null, text: "", tone: "bad" });
  if (Math.abs(s.rival_price_change_pct) >= 1)
    all.push({ label: "Rival", arrow: s.rival_price_change_pct > 0 ? "up" : "down", text: n(s.rival_price_change_pct), tone: s.rival_price_change_pct > 0 ? "good" : "bad" });
  if (s.delta_lead_time >= 0.5) all.push({ label: "Delay", arrow: null, text: `+${Math.round(s.delta_lead_time)} wk`, tone: "bad" });
  if (Math.abs(s.demand_shock) >= 0.02)
    all.push({ label: "Demand", arrow: s.demand_shock > 0 ? "up" : "down", text: n(s.demand_shock * 100), tone: s.demand_shock > 0 ? "good" : "bad" });
  if (!all.length) return [{ label: s.label.trim().split(/\s+/).slice(0, 3).join(" ") || "Test", arrow: null, text: "", tone: "neutral" }];
  return all.slice(0, 2);
}

/** Everything the header tooltip says, so no information is lost. */
export const futureTitle = (s: ShockCase) =>
  [s.id === "news" ? "Today's news" : null, s.label, s.cost_line, s.why].filter(Boolean).join("\n");
