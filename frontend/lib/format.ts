/** Number and text formatting per docs/DESIGN.md §6. */

const MINUS = "−";

export function isValidNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function trim1(x: number): string {
  return x.toFixed(1).replace(/\.0$/, "");
}

/** "$38.00" — a price. */
export function formatPrice(x: number): string {
  return `$${x.toFixed(2)}`;
}

/** "$15.5k", "$1.2M", "$840" — an unsigned money amount. */
export function formatMoney(x: number): string {
  const a = Math.abs(x);
  const sign = x < 0 ? MINUS : "";
  if (a >= 1_000_000) return `${sign}$${trim1(a / 1_000_000)}M`;
  if (a >= 1_000) return `${sign}$${trim1(a / 1_000)}k`;
  return `${sign}$${Math.round(a)}`;
}

/** Always signed, real minus: "+$5.0k", "−$1.8k". Under $10k keeps one decimal in k; ~0 shows "$0". */
export function formatDelta(x: number): string {
  if (!isValidNumber(x) || Math.round(Math.abs(x)) === 0) return "$0";
  const a = Math.abs(x);
  const sign = x < 0 ? MINUS : "+";
  if (a >= 1_000_000) return `${sign}$${trim1(a / 1_000_000)}M`;
  if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(1)}k`;
  return `${sign}$${Math.round(a)}`;
}

/** "$38.00 → $39.14" */
export function formatPriceChange(from: number, to: number): string {
  return `${formatPrice(from)} → ${formatPrice(to)}`;
}

/** "Week 7 of 24" (weeks are 0-based ticks, shown 1-based). */
export function formatWeek(tick: number, total = 24): string {
  return `Week ${tick + 1} of ${total}`;
}

/** "wk 7" */
export function formatWeekShort(tick: number): string {
  return `wk ${tick + 1}`;
}

/** "42%" — at most one decimal. */
export function formatPercent(frac: number, digits = 1): string {
  if (!isValidNumber(frac)) return "–";
  return `${trim1(Number((frac * 100).toFixed(digits)))}%`;
}

/** "+31%" / "−12%" from a fraction. */
export function formatSignedPercent(frac: number): string {
  const v = Math.round(frac * 100);
  return v < 0 ? `${MINUS}${Math.abs(v)}%` : `+${v}%`;
}

/** "42 of 100 runs" style: "9 in 10". */
export function formatRuns(n: number): string {
  return n.toLocaleString("en-US");
}

/** "23 Nemotron calls · $0.06 · 58% cheaper than all-Ultra" */
export function formatCredibility(calls: number, costUsd: number, savingsPct: number): string {
  const base = `${calls} Nemotron calls · $${costUsd.toFixed(2)}`;
  return savingsPct > 0 ? `${base} · ${Math.round(savingsPct)}% cheaper than all-Ultra` : base;
}
