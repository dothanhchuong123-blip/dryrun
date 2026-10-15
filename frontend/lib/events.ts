/**
 * Backend ↔ frontend contract, v2.1 (docs/EVENTS.md). Types for every REST body/response and SSE event.
 * Arrays indexed by firm are [A, B]: A = the user's business, B = the rival. Shares are [outside, A, B].
 * Money is USD; time is weeks.
 */

export type FirmPair = [number, number];
export type ShareTriple = [number, number, number];
export type ModelTier = "ultra" | "super" | "fast";
export type RunMode = "live" | "replay";
export type Likelihood = "likely" | "possible" | "unlikely";
export type ShockOrigin = "news" | "ai" | "default";
export type PlanSource = "seed" | "ai" | "user";
export type CellSource = "local" | "cloud";
export type JobStatus = "idle" | "queued" | "running" | "verified" | "failed";

// ---- shared objects ---------------------------------------------------------------------------

export interface BusinessProfile {
  business_name: string;
  product_unit: string;
  price: number;
  unit_cost: number;
  weekly_sales: number;
  lead_time_weeks: number;
  stock_weeks: number;
  rival_name: string;
  rival_price: number;
  supplier_region: string;
  customers: string;
  search_terms: string[];
  country: string;
  market_terms: string[];
  exposed_cost_share: number;
  /** 0 = not given */
  cash_available: number;
  guessed_fields: string[];
}

export interface PlanSpec {
  name: string;
  price_change_pct: number;
  price_change_week: number;
  extra_stock_weeks: number;
  stock_week: number;
  marketing_change_pct: number;
  switch_supplier: boolean;
  alt_cost_change_pct: number;
  alt_lead_time_weeks: number;
  alt_shock_exposure: number;
}

export interface ShockCase {
  id: string;
  label: string;
  /** change in the news INPUT's price, not in the user's unit cost */
  delta_c_raw: number;
  delta_lead_time: number;
  demand_shock: number;
  onset_week: number;
  ramp_weeks: number;
  rival_price_change_pct: number;
  share_shift_pct: number;
  likelihood: Likelihood;
  why: string;
  source_ids: string[];
  origin: ShockOrigin;
  cost_line: string | null;
}

/** The five lines sum to mean_delta_usd. */
export interface CellBridge {
  cost_usd: number;
  price_usd: number;
  volume_usd: number;
  marketing_usd: number;
  holding_usd: number;
}

// ---- REST -------------------------------------------------------------------------------------

export interface ExampleSummary {
  id: string;
  title: string;
  subtitle: string;
  text: string;
  has_replay: boolean;
}
export type ExamplesResponse = ExampleSummary[];

export interface ParseProfileRequest {
  text: string;
}
export interface ParseProfileResponse {
  profile: BusinessProfile;
  fallback_used: boolean;
}

export interface CreateAnalysisRequest {
  example_id?: string;
  profile?: BusinessProfile;
  mode: RunMode;
}
export interface CreateAnalysisResponse {
  analysis_id: string;
  mode: RunMode;
}
/** HTTP 429 body from POST /api/analyses */
export interface RateLimitedResponse {
  reason: string;
}

export interface AddPlanRequest {
  plan: PlanSpec;
}
export interface AcceptedResponse {
  accepted: boolean;
  reason?: string;
}
export type AddPlanResponse = AcceptedResponse;
export type NewsCheckResponse = AcceptedResponse;
export interface VerifyResponse {
  accepted: boolean;
  job_id?: string;
}

export interface StartReplayRequest {
  plan_name: string;
  shock_id: string;
  speed?: number;
}
export interface StartReplayResponse {
  replay_id: string;
}
export interface StopResponse {
  stopped: boolean;
}
export type BenchmarkFormat = "json" | "md";

// ---- analysis stream --------------------------------------------------------------------------

export interface AnalysisEventData {
  analysis_id: string;
  mode: RunMode;
  example_id: string | null;
  profile: BusinessProfile;
  horizon_weeks: number;
  n_paths: number;
}

export type NewsKind = "supply" | "market";
export interface NewsItem {
  id: string;
  kind: NewsKind;
  title: string;
  url: string;
  source: string;
  published: string;
  /** supply: verbatim quote; market: ≤ 200-char snippet */
  quote: string;
  shock: { delta_c_raw: number; delta_lead_time: number; demand_shock: number } | null;
  cost_line: string | null;
  impact_usd: number | null;
  impact_p5_usd: number | null;
  live: boolean;
  applied: boolean;
}
export interface NewsEventData {
  items: NewsItem[];
  used_for_grid: string | null;
}

export interface UnmodelledRisk {
  text: string;
  source_id: string | null;
}
export interface ScenariosEventData {
  thought: string;
  unmodelled: UnmodelledRisk[];
  fallback_used: boolean;
}

export interface ShocksEventData {
  cases: ShockCase[];
}

export interface PlanEventData {
  name: string;
  source: PlanSource;
  round: number;
  spec: PlanSpec;
}

export interface CrowdArchetype {
  id: number;
  label: string;
  mu: FirmPair;
  sigma: FirmPair;
  bubble: string;
}
export interface CrowdEventData {
  plan_name: string;
  archetypes: CrowdArchetype[];
}

export interface GridCellData {
  plan_name: string;
  shock_id: string;
  n: number;
  mean_delta_usd: number;
  p5_delta_usd: number;
  p_better: number;
  mean_profit_usd: number;
  source: CellSource;
  bridge: CellBridge;
  steady_rival_delta_usd: number | null;
  peak_cash_usd: number;
  payback_week: number | null;
  over_cash: boolean;
}

export interface GridSummaryData {
  baseline_profit_usd: Record<string, number>;
  best_today: string;
  safest: string;
  verified: boolean;
}

export type AgentStepKind = "think" | "test" | "result" | "shoppers" | "finish" | "fallback";
export type AgentTier = ModelTier | "engine";
export interface AgentStepData {
  round: number;
  kind: AgentStepKind;
  /** ≤ 300 chars, plain words */
  text: string;
  plan_name: string | null;
  tier: AgentTier;
  latency_ms: number | null;
}

export type ReasoningRole = "analyst" | "scenarios";
export interface ReasoningData {
  role: ReasoningRole;
  round: number;
  delta: string;
}
export interface ReasoningDoneData {
  role: ReasoningRole;
  round: number;
}

export interface MemoNumbers {
  shock_id: string;
  mean_delta_usd: number;
  p5_delta_usd: number;
  p_better: number;
  n: number;
  verified: boolean;
  bridge: CellBridge;
  steady_rival_delta_usd: number | null;
  peak_cash_usd: number;
  payback_week: number | null;
  over_cash: boolean;
  cash_available: number;
}
export interface MemoSource {
  title: string;
  url: string;
  quote: string;
}
export interface MemoEventData {
  plan_name: string;
  headline: string;
  why: string;
  watch_out: string;
  recheck_when: string;
  numbers: MemoNumbers;
  cost_line: string | null;
  sources: MemoSource[];
  not_modelled: { fixed: string[]; found: UnmodelledRisk[] };
  fallback_used: boolean;
}

export interface TierTelemetry {
  calls: number;
  tokens_in: number;
  tokens_out: number;
  p50_ttft_ms: number;
  tok_per_s: number;
  errors: number;
}
export interface TelemetryData {
  tiers: Record<ModelTier, TierTelemetry>;
  call_share: Record<ModelTier, number>;
  token_share: Record<ModelTier, number>;
  cost_usd: number;
  cost_all_ultra_usd: number;
  savings_pct: number;
  job: { id: string | null; status: JobStatus };
}

export interface ModeEventData {
  mode: RunMode;
  reason: string;
}
export interface ErrorEventData {
  message: string;
  recoverable: boolean;
}
export interface DoneData {
  analysis_id: string;
  cost_usd: number;
}

// ---- replay stream ----------------------------------------------------------------------------

export interface ReplayStartData {
  replay_id: string;
  plan_name: string;
  shock_id: string;
  shock_label: string;
  weeks: number;
  n_consumers: number;
  week_seconds: number;
}

export interface TickEventData {
  tick: number;
  /** "U1" = the plan, "U2" = do nothing */
  universe: "U1" | "U2";
  price: FirmPair;
  qty: FirmPair;
  demand: FirmPair;
  sales: FirmPair;
  unmet: FirmPair;
  spill_in: FirmPair;
  lost: number;
  inventory: FirmPair;
  raw_inv: FirmPair;
  rop: FirmPair;
  orders: FirmPair;
  profit: FirmPair;
  cum_profit: FirmPair;
  shares: ShareTriple;
  c_raw: number;
  lead_time: number;
  mc: FirmPair;
  atc: FirmPair;
  bullwhip: [number | null, number | null];
  // v2.1
  unit_cost: FirmPair;
  cover_weeks: FirmPair;
  in_transit: FirmPair;
  /** U1 only */
  cum_cash_delta?: number;
  // P2b
  old_cost_share?: FirmPair;
  spot_cost?: FirmPair;
  /** U1 only: base64 of N int8: 0 = outside, 1 = A, 2 = B */
  choices_b64?: string;
}

export type MarkerKind =
  | "shock"
  | "price_change"
  | "stock_ordered"
  | "stock_arrives"
  | "sold_out"
  | "rival_move"
  | "rival_price"
  | "new_player";
export interface MarkerData {
  week: number;
  kind: MarkerKind;
  firm: "A" | "B" | null;
  /** ≤ 14 words */
  text: string;
}
export interface ReplayDoneData {
  replay_id: string;
  cum_profit_usd: { U1: number; U2: number };
}

// ---- event names and payload maps --------------------------------------------------------------

export interface AnalysisEventMap {
  analysis: AnalysisEventData;
  news: NewsEventData;
  scenarios: ScenariosEventData;
  shocks: ShocksEventData;
  plan: PlanEventData;
  crowd: CrowdEventData;
  grid_cell: GridCellData;
  grid_summary: GridSummaryData;
  agent_step: AgentStepData;
  reasoning: ReasoningData;
  reasoning_done: ReasoningDoneData;
  memo: MemoEventData;
  telemetry: TelemetryData;
  mode: ModeEventData;
  error: ErrorEventData;
  done: DoneData;
}
export interface ReplayEventMap {
  replay_start: ReplayStartData;
  tick: TickEventData;
  marker: MarkerData;
  replay_done: ReplayDoneData;
}

export const ANALYSIS_EVENT_NAMES = [
  "analysis",
  "news",
  "scenarios",
  "shocks",
  "plan",
  "crowd",
  "grid_cell",
  "grid_summary",
  "agent_step",
  "reasoning",
  "reasoning_done",
  "memo",
  "telemetry",
  "mode",
  "error",
  "done",
] as const satisfies readonly (keyof AnalysisEventMap)[];
export const REPLAY_EVENT_NAMES = [
  "replay_start",
  "tick",
  "marker",
  "replay_done",
] as const satisfies readonly (keyof ReplayEventMap)[];
export const SSE_EVENT_NAMES = [...ANALYSIS_EVENT_NAMES, ...REPLAY_EVENT_NAMES] as const;

export type AnalysisEventName = keyof AnalysisEventMap;
export type ReplayEventName = keyof ReplayEventMap;
export type AnalysisEvent = {
  [K in AnalysisEventName]: { event: K; data: AnalysisEventMap[K] };
}[AnalysisEventName];
export type ReplayEvent = {
  [K in ReplayEventName]: { event: K; data: ReplayEventMap[K] };
}[ReplayEventName];

// ---- helpers ----------------------------------------------------------------------------------

/** Decode `choices_b64` (N int8: 0 outside, 1 A, 2 B) into `target` when the size matches, else a new array. */
export function decodeChoicesB64(b64: string, target?: Int8Array): Int8Array {
  if (!b64) {
    return target ?? new Int8Array(0);
  }
  let binary = "";
  if (typeof globalThis.atob === "function") {
    binary = globalThis.atob(b64);
  } else if (typeof Buffer !== "undefined") {
    binary = Buffer.from(b64, "base64").toString("binary");
  }
  const len = binary.length;
  const out = target && target.length === len ? target : new Int8Array(len);
  for (let i = 0; i < len; i++) {
    const byte = binary.charCodeAt(i) & 0xff;
    out[i] = byte > 127 ? byte - 256 : byte;
  }
  return out;
}
