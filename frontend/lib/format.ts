import { NashLabel, ShockParam } from "./events";

export function isValidNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Format a number using compact suffix notation (k, M) to prevent layout shift.
 */
export function formatCompactNumber(
  value: number | null | undefined,
  decimals = 1
): string {
  if (!isValidNumber(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(decimals)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}${(abs / 1_000).toFixed(decimals)}k`;
  }
  if (abs >= 100 || Number.isInteger(abs)) {
    return `${sign}${Math.round(abs)}`;
  }
  return `${sign}${abs.toFixed(decimals)}`;
}

export const formatK = formatCompactNumber;

export interface CurrencyFormatOptions {
  compact?: boolean;
  decimals?: number;
  signed?: boolean;
}

/**
 * Format USD currency values ($15.0k, +$1.2k, $95.00).
 */
export function formatCurrency(
  value: number | null | undefined,
  opts?: CurrencyFormatOptions
): string {
  if (!isValidNumber(value)) return "—";
  const compact = opts?.compact ?? Math.abs(value) >= 1_000;
  const signed = opts?.signed ?? false;
  const abs = Math.abs(value);
  const signPrefix = value < 0 ? "-" : signed && value > 0 ? "+" : "";

  if (compact) {
    const dec = opts?.decimals ?? (abs >= 10_000 ? 1 : 2);
    if (abs >= 1_000_000) {
      return `${signPrefix}$${(abs / 1_000_000).toFixed(dec)}M`;
    }
    if (abs >= 1_000) {
      return `${signPrefix}$${(abs / 1_000).toFixed(dec)}k`;
    }
  }

  const dec = opts?.decimals ?? (abs >= 100 ? 0 : 2);
  return `${signPrefix}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  })}`;
}

export function formatUSD(
  value: number | null | undefined,
  decimals = 2
): string {
  return formatCurrency(value, { compact: false, decimals });
}

export function formatSignedCurrency(
  value: number | null | undefined,
  decimals = 1
): string {
  return formatCurrency(value, { compact: true, decimals, signed: true });
}

export interface PercentFormatOptions {
  decimals?: number;
  signed?: boolean;
  isFraction?: boolean;
}

/**
 * Format percentages (e.g. 0.25 -> "+25.0%" when isFraction=true, or 25 -> "25.0%").
 */
export function formatPercent(
  value: number | null | undefined,
  opts?: PercentFormatOptions
): string {
  if (!isValidNumber(value)) return "—";
  const isFraction = opts?.isFraction ?? false;
  const decimals = opts?.decimals ?? 1;
  const signed = opts?.signed ?? false;

  const pct = isFraction ? value * 100 : value;
  const signPrefix = pct < 0 ? "-" : signed && pct > 0 ? "+" : "";
  return `${signPrefix}${Math.abs(pct).toFixed(decimals)}%`;
}

export function formatPct(
  value: number | null | undefined,
  decimals = 1,
  signed = false
): string {
  return formatPercent(value, { decimals, signed, isFraction: false });
}

/**
 * Format integer counts with locale thousands separators (e.g. 10,000).
 */
export function formatInt(value: number | null | undefined): string {
  if (!isValidNumber(value)) return "—";
  return Math.round(value).toLocaleString("en-US");
}

/**
 * Format ratios such as Bullwhip (Var(Orders)/Var(Demand)).
 * Returns empty string when null if blankOnNull is true.
 */
export function formatRatio(
  value: number | null | undefined,
  decimals = 2,
  blankOnNull = false
): string {
  if (!isValidNumber(value)) {
    return blankOnNull ? "" : "—";
  }
  return `${value.toFixed(decimals)}×`;
}

/**
 * Format statistical metrics (Cohen's d, chi2, etc.).
 */
export function formatStat(
  value: number | null | undefined,
  decimals = 2,
  signed = false
): string {
  if (!isValidNumber(value)) return "—";
  const sign = value > 0 && signed ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(decimals)}`;
}

/**
 * Format p-values cleanly with floor threshold (<0.0001).
 */
export function formatPValue(p: number | null | undefined): string {
  if (!isValidNumber(p)) return "—";
  if (p < 0) return "—";
  if (p < 0.0001) return "<0.0001";
  if (p < 0.01) return p.toFixed(4);
  return p.toFixed(3);
}

/**
 * Format 95% confidence interval pair [lo, hi].
 */
export function formatCI95(
  ci: [number, number] | null | undefined,
  isCurrency = true
): string {
  if (!ci || !Array.isArray(ci) || ci.length < 2) return "—";
  const [lo, hi] = ci;
  if (!isValidNumber(lo) || !isValidNumber(hi)) return "—";
  if (isCurrency) {
    return `[${formatCurrency(lo, { compact: true, decimals: 1 })}, ${formatCurrency(
      hi,
      { compact: true, decimals: 1 }
    )}]`;
  }
  return `[${formatCompactNumber(lo, 1)}, ${formatCompactNumber(hi, 1)}]`;
}

/**
 * Map ShockParam keys to readable mathematical symbols.
 */
export function formatShockParamLabel(param: ShockParam | string): string {
  switch (param) {
    case "delta_c_raw":
      return "Δc_raw";
    case "delta_lead_time":
      return "ΔL";
    case "demand_shock":
      return "ΔD";
    default:
      return param;
  }
}

/**
 * Format ShockParam values with appropriate units (%, ticks).
 */
export function formatShockValue(
  param: ShockParam | string,
  value: number | null | undefined
): string {
  if (!isValidNumber(value)) return "—";
  if (param === "delta_c_raw" || param === "demand_shock") {
    const pct = value * 100;
    const sign = pct > 0 ? "+" : pct < 0 ? "-" : "";
    const decimals = Number.isInteger(Math.round(pct * 10) / 10) ? 0 : 1;
    return `${sign}${Math.abs(pct).toFixed(decimals)}%`;
  }
  if (param === "delta_lead_time") {
    const sign = value > 0 ? "+" : value < 0 ? "-" : "";
    const abs = Math.abs(Math.round(value));
    return `${sign}${abs} ${abs === 1 ? "tick" : "ticks"}`;
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value}`;
}

/**
 * Format full parameter delta string for Tavily Grounding Proof Cards,
 * e.g. "Δc_raw = +25%" or "ΔL = +3 ticks".
 */
export function formatShockDelta(
  param: ShockParam | string,
  value: number | null | undefined
): string {
  return `${formatShockParamLabel(param)} = ${formatShockValue(param, value)}`;
}

/**
 * Extract clean hostname domain from a URL (e.g. "reuters.com").
 */
export function extractDomain(url: string | null | undefined): string {
  if (!url || typeof url !== "string") return "source";
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, "") || "source";
  } catch {
    const match = url.match(/^(?:https?:\/\/)?(?:www\.)?([^/?#]+)/i);
    return match?.[1] ?? "source";
  }
}

/**
 * Format ISO timestamp or epoch milliseconds into HH:MM:SS.
 */
export function formatTimestamp(
  ts: string | number | null | undefined
): string {
  if (ts === null || ts === undefined || ts === "") return "";
  try {
    const date = typeof ts === "number" ? new Date(ts) : new Date(String(ts));
    if (Number.isNaN(date.getTime())) return String(ts);
    return date.toISOString().slice(11, 19);
  } catch {
    return String(ts);
  }
}

/**
 * Format Nash equilibrium regime chip label and theme.
 */
export function formatNashLabel(label: NashLabel | string | undefined): {
  text: string;
  description: string;
  chipClass: string;
} {
  switch (label) {
    case "nash":
      return {
        text: "Nash",
        description: "Mutual best-response equilibrium",
        chipClass:
          "border-cyan-500/50 bg-cyan-950/70 text-cyan-200 shadow-[0_0_8px_rgba(34,211,238,0.15)]",
      };
    case "price_war":
      return {
        text: "Price war",
        description: "Prisoner's Dilemma mutual undercut",
        chipClass:
          "border-rose-500/50 bg-rose-950/70 text-rose-200 shadow-[0_0_8px_rgba(244,63,94,0.15)]",
      };
    case "collusion":
      return {
        text: "Collusion",
        description: "Tacit supra-competitive pricing",
        chipClass:
          "border-amber-500/50 bg-amber-950/70 text-amber-200 shadow-[0_0_8px_rgba(245,158,11,0.15)]",
      };
    default:
      return {
        text: "Off-NE",
        description: "Non-equilibrium transition play",
        chipClass: "border-slate-600 bg-slate-800/80 text-slate-300",
      };
  }
}
