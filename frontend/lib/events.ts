/**
 * Backend <-> Frontend contract types (SSE + REST).
 * Strictly follows docs/EVENTS.md and SPEC.md §5 / §8 / §9.
 *
 * All firm-indexed arrays are [A, B].
 * All share arrays are [outside, A, B].
 * Money is in USD. Time is in ticks.
 */

export type FirmIndex = 0 | 1;
export type FirmPair<T = number> = [T, T];
export type ShareTriple<T = number> = [T, T, T];

export type RunMode = "live" | "replay";
export type Universe = "U1" | "U2";
export type ModelTier = "ultra" | "super" | "fast";
export type DecisionRole =
  | "ceo_A"
  | "ceo_B"
  | "inventory"
  | "shock_parser"
  | "crowd";

export type ShockParam = "delta_c_raw" | "delta_lead_time" | "demand_shock";
export type NashAction = "cut" | "hold" | "raise";
export type NashLabel = "nash" | "price_war" | "collusion" | "other";
export type StatsSource = "live" | "cloud";
export type JobStatus = "idle" | "queued" | "running" | "verified" | "failed";
export type Matrix3x3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number]
];

/* -------------------------------------------------------------------------- */
/* REST Contract Types                                                        */
/* -------------------------------------------------------------------------- */

export interface HealthResponse {
  status: "ok" | string;
}

export interface ScenarioSummary {
  id: string;
  title: string;
  subtitle: string;
  has_replay: boolean;
}
export type ScenarioInfo = ScenarioSummary;

export interface StartRunRequest {
  scenario_id: string;
  mode: RunMode;
}

export interface StartRunResponse {
  run_id: string;
  mode: RunMode;
}

export interface ShockRequest {
  text: string;
}

export interface ShockResponse {
  accepted: boolean;
  reason?: string;
}

export interface StopRunResponse {
  stopped: boolean;
}

export interface NewsCheckResponse {
  accepted: boolean;
  reason?: string;
}

export type BenchmarkExportFormat = "json" | "md";

/* -------------------------------------------------------------------------- */
/* LLM Structured Decision Schemas (SPEC §5)                                  */
/* -------------------------------------------------------------------------- */

export interface EvidenceItem {
  quote: string;
  url: string;
}

export interface ShockVectorDecision {
  delta_c_raw: number;
  delta_lead_time: number;
  demand_shock: number;
  severity: number;
  evidence: EvidenceItem[];
}

export interface InventoryDecision {
  omega: number;
  rationale: string;
}

export interface CEODecision {
  price: number;
  production_qty: number;
  marketing_budget: number;
  expected_rival_action: NashAction;
  rationale: string;
}

export interface ArchetypeSentimentDecision {
  id: number;
  mu: number | FirmPair<number>;
  sigma: number | FirmPair<number>;
  bubble: string;
}

export interface CrowdBatchDecision {
  archetypes: ArchetypeSentimentDecision[];
}

export type DecisionPayloadMap = {
  ceo_A: CEODecision;
  ceo_B: CEODecision;
  inventory: InventoryDecision;
  shock_parser: ShockVectorDecision;
  crowd: CrowdBatchDecision;
};

/* -------------------------------------------------------------------------- */
/* SSE Event Payloads (docs/EVENTS.md)                                        */
/* -------------------------------------------------------------------------- */

export interface ScenarioEventData {
  run_id: string;
  scenario_id: string;
  title: string;
  mode: RunMode;
  n_consumers: number;
  tick_seconds: number;
  epoch_ticks: number;
}
export type ScenarioEvent = ScenarioEventData;

export interface TickEventData {
  tick: number;
  universe: Universe;
  price: FirmPair<number>;
  qty: FirmPair<number>;
  demand: FirmPair<number>;
  sales: FirmPair<number>;
  unmet: FirmPair<number>;
  spill_in: FirmPair<number>;
  lost: number;
  inventory: FirmPair<number>;
  raw_inv: FirmPair<number>;
  rop: FirmPair<number>;
  orders: FirmPair<number>;
  profit: FirmPair<number>;
  cum_profit: FirmPair<number>;
  shares: ShareTriple<number>;
  c_raw: number;
  lead_time: number;
  mc: FirmPair<number>;
  atc: FirmPair<number>;
  bullwhip: FirmPair<number | null> | null;
  /** Present on U1 ticks only; base64 of N int8: 0=outside, 1=A, 2=B */
  choices_b64?: string;
}
export type TickEvent = TickEventData;
export type TickPayload = TickEventData;

export interface DecisionEventData<R extends DecisionRole = DecisionRole> {
  tick: number;
  role: R;
  tier: ModelTier;
  model: string;
  decision: R extends keyof DecisionPayloadMap
    ? DecisionPayloadMap[R] & Record<string, unknown>
    : Record<string, unknown>;
  fallback_used: boolean;
  latency_ms: number;
}
export type DecisionEvent = DecisionEventData;

export interface ReasoningEventData {
  role: DecisionRole | string;
  delta: string;
  tick?: number;
}
export type ReasoningEvent = ReasoningEventData;

export interface ReasoningDoneEventData {
  role: DecisionRole | string;
  tick?: number;
}
export type ReasoningDoneEvent = ReasoningDoneEventData;

export interface CrowdArchetype {
  id: number;
  label: string;
  mu: FirmPair<number>;
  sigma: FirmPair<number>;
  bubble: string;
}

export interface CrowdEventData {
  tick: number;
  archetypes: CrowdArchetype[];
}
export type CrowdEvent = CrowdEventData;

export interface GroundingEventData {
  id: string;
  query: string;
  url: string;
  title: string;
  quote: string;
  param: ShockParam;
  value: number;
  ts: string | number;
  live: boolean;
  applied: boolean;
}
export type GroundingEvent = GroundingEventData;
export type GroundingCard = GroundingEventData;

export interface MixedNashEquilibrium {
  p_A: [number, number, number];
  p_B: [number, number, number];
}

export interface NashEventData {
  tick: number;
  actions: [NashAction, NashAction, NashAction] | string[];
  payoff_A: Matrix3x3;
  payoff_B: Matrix3x3;
  pure_ne: Array<[number, number]>;
  mixed_ne: MixedNashEquilibrium | null;
  chosen: [number, number];
  label: NashLabel;
}
export type NashEvent = NashEventData;

export interface StatsEventData {
  tick: number;
  source: StatsSource;
  n: number;
  delta_mean: number;
  ci95: [number, number];
  cohens_d: number;
  cohens_dz?: number | null;
  p_value: number;
  chi2: number | null;
  chi2_p: number | null;
}
export type StatsEvent = StatsEventData;

export interface TierTelemetryMetrics {
  calls: number;
  tokens_in: number;
  tokens_out: number;
  p50_ttft_ms: number;
  tok_per_s: number;
  errors: number;
}

export interface TelemetryJobState {
  id: string | null;
  status: JobStatus;
}

export interface TelemetryEventData {
  tiers: Record<ModelTier, TierTelemetryMetrics>;
  call_share: Record<ModelTier, number>;
  token_share: Record<ModelTier, number>;
  cost_usd: number;
  cost_all_ultra_usd: number;
  savings_pct: number;
  job: TelemetryJobState;
}
export type TelemetryEvent = TelemetryEventData;

export interface ModeEventData {
  mode: RunMode;
  reason: string;
}
export type ModeEvent = ModeEventData;

export interface ErrorEventData {
  message: string;
  recoverable: boolean;
}
export type ErrorEvent = ErrorEventData;

/* -------------------------------------------------------------------------- */
/* Discriminated Union of All SSE Events                                      */
/* -------------------------------------------------------------------------- */

export interface SSEEventMap {
  scenario: ScenarioEventData;
  tick: TickEventData;
  decision: DecisionEventData;
  reasoning: ReasoningEventData;
  reasoning_done: ReasoningDoneEventData;
  crowd: CrowdEventData;
  grounding: GroundingEventData;
  nash: NashEventData;
  stats: StatsEventData;
  telemetry: TelemetryEventData;
  mode: ModeEventData;
  error: ErrorEventData;
}

export type SSEEventName = keyof SSEEventMap;

export const SSE_EVENT_NAMES: readonly SSEEventName[] = [
  "scenario",
  "tick",
  "decision",
  "reasoning",
  "reasoning_done",
  "crowd",
  "grounding",
  "nash",
  "stats",
  "telemetry",
  "mode",
  "error",
] as const;

export type MarketSSEEvent = {
  [K in SSEEventName]: {
    event: K;
    data: SSEEventMap[K];
  };
}[SSEEventName];

export type SSEEvent = MarketSSEEvent;

/**
 * JSONL replay line format in fixtures/replays/<scenario_id>.jsonl
 */
export interface ReplayLine<K extends SSEEventName = SSEEventName> {
  t: number;
  event: K;
  data: SSEEventMap[K];
}

/* -------------------------------------------------------------------------- */
/* Binary Choices Helpers (0=outside, 1=A, 2=B)                               */
/* -------------------------------------------------------------------------- */

/**
 * Decode base64-encoded consumer choices (N int8 values: 0=outside, 1=A, 2=B)
 * into a target Int8Array (or allocate a new Int8Array if size differs).
 */
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

/**
 * Encode an Int8Array / number[] of consumer choices (0=outside, 1=A, 2=B)
 * into a base64 string.
 */
export function encodeChoicesB64(choices: ArrayLike<number>): string {
  const len = choices.length;
  let binary = "";
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(choices[i] & 0xff);
  }
  if (typeof globalThis.btoa === "function") {
    return globalThis.btoa(binary);
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(binary, "binary").toString("base64");
  }
  return "";
}

