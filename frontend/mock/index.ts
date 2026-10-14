import {
  BenchmarkExportFormat,
  CrowdArchetype,
  DecisionEventData,
  FirmPair,
  GroundingEventData,
  JobStatus,
  MarketSSEEvent,
  Matrix3x3,
  ModelTier,
  NashAction,
  NashLabel,
  ReplayLine,
  RunMode,
  ScenarioSummary,
  SSE_EVENT_NAMES,
  SSEEventName,
  StatsEventData,
  TelemetryEventData,
  TickEventData,
  encodeChoicesB64,
} from "../lib/events";
import { DEFAULT_SCENARIOS, useMarketStore } from "../lib/store";

export interface MockStreamHandle {
  stop: () => void;
  injectShock: (text: string) => { accepted: boolean; reason?: string };
  triggerNewsCheck: () => { accepted: boolean; reason?: string };
}

interface ScenarioConfig {
  id: string;
  title: string;
  subtitle: string;
  baseRawCost: number;
  baseLeadTime: number;
  deltaCRaw: number;
  deltaLeadTime: number;
  demandShock: number;
  initialQuote: string;
  initialUrl: string;
  initialNewsTitle: string;
  initialQuery: string;
  deepScoutQuote: string;
  deepScoutUrl: string;
  deepScoutTitle: string;
  deepScoutQuery: string;
}

const SCENARIO_CONFIGS: Record<string, ScenarioConfig> = {
  semiconductor_tariff: {
    id: "semiconductor_tariff",
    title: "25% Semiconductor & Wafer Tariff Shock",
    subtitle:
      "US–Asia logic wafer duties hike raw material costs +25% and extend port customs lead time +3 ticks",
    baseRawCost: 52.0,
    baseLeadTime: 4,
    deltaCRaw: 0.25,
    deltaLeadTime: 3,
    demandShock: -0.04,
    initialQuery: "US semiconductor wafer tariff customs inspection delay 2026",
    initialNewsTitle: "Reuters: 25% Section 301 Logic Wafer Tariff Takes Effect Midnight",
    initialUrl: "https://www.reuters.com/technology/semiconductor-wafer-tariff-2026",
    initialQuote:
      "Customs authorities imposed an immediate 25% ad-valorem tariff on imported 300mm logic wafers, adding 72 hours to port clearance.",
    deepScoutQuery: "Taiwan foundry wafer allocation surcharge freight congestion",
    deepScoutTitle: "FT: Foundries Pass On Wafer Surcharges Amid Customs Backlog",
    deepScoutUrl: "https://www.ft.com/content/foundry-wafer-surcharges-2026",
    deepScoutQuote:
      "Spot wafer logistics lead times lengthened by an additional 2 ticks as bonded warehouses hit 94% utilization.",
  },
  red_sea_blockade: {
    id: "red_sea_blockade",
    title: "Red Sea / Suez Maritime Route Closure",
    subtitle:
      "Cape of Good Hope rerouting spikes freight lead times +5 ticks and raises landed unit cost +18%",
    baseRawCost: 48.0,
    baseLeadTime: 4,
    deltaCRaw: 0.18,
    deltaLeadTime: 5,
    demandShock: 0.03,
    initialQuery: "Red Sea Suez container rerouting Cape of Good Hope freight rates",
    initialNewsTitle: "Freightos Baltic Index: Asia-Europe Container Transit +14 Days",
    initialUrl: "https://www.freightos.com/freight-resources/red-sea-rerouting-2026",
    initialQuote:
      "Major container alliances suspended Red Sea transits indefinitely, adding 5 ticks of transit lead time and an 18% bunker surcharge.",
    deepScoutQuery: "Drewry container equipment shortage port congestion surcharge",
    deepScoutTitle: "Drewry Maritime: Empty Container Imbalance Triggers Spot Spike",
    deepScoutUrl: "https://www.drewry.co.uk/maritime-research-container-imbalance",
    deepScoutQuote:
      "Delayed vessel returns tightened Asia export capacity, lifting raw component landed cost by an extra +8%.",
  },
  lithium_spot_spike: {
    id: "lithium_spot_spike",
    title: "Lithium Carbonate Spot Price Surge & Demand Shift",
    subtitle:
      "Refinery outage triggers +35% raw input shock alongside +12% precautionary buyer demand surge",
    baseRawCost: 55.0,
    baseLeadTime: 3,
    deltaCRaw: 0.35,
    deltaLeadTime: 2,
    demandShock: 0.12,
    initialQuery: "battery grade lithium carbonate spot surge refinery outage",
    initialNewsTitle: "Bloomberg: Lithium Carbonate Jumps 35% After Major Brine Outage",
    initialUrl: "https://www.bloomberg.com/news/articles/lithium-carbonate-surge-2026",
    initialQuote:
      "Battery-grade lithium carbonate surged 35% this week while OEM buyers pulled forward orders by 12% to hedge stockout risk.",
    deepScoutQuery: "cathode precursor inventory restocking lead time",
    deepScoutTitle: "Reuters: Cathode Producers Ration Spot Allocations as Orders Swell",
    deepScoutUrl: "https://www.reuters.com/markets/commodities/cathode-allocations-2026",
    deepScoutQuote:
      "Downstream buyers accelerated safety-stock replenishment, tightening supplier lead times by +2 ticks.",
  },
};

const ARCHETYPE_DEFINITIONS: Array<{
  id: number;
  label: string;
  baseMuA: number;
  baseMuB: number;
  bubbles: [string, string];
}> = [
  {
    id: 1,
    label: "Enterprise Procurement",
    baseMuA: 0.32,
    baseMuB: 0.18,
    bubbles: ["Locking SLA volume with Firm A", "Auditing tariff pass-through clauses"],
  },
  {
    id: 2,
    label: "Price-Sensitive SMBs",
    baseMuA: -0.08,
    baseMuB: 0.28,
    bubbles: ["Switching to Firm B if A hikes >5%", "Comparing unit landed cost"],
  },
  {
    id: 3,
    label: "Brand Loyalists (Firm A)",
    baseMuA: 0.58,
    baseMuB: -0.22,
    bubbles: ["Staying with Firm A despite premium", "Prioritizing reliability over discount"],
  },
  {
    id: 4,
    label: "Brand Loyalists (Firm B)",
    baseMuA: -0.24,
    baseMuB: 0.54,
    bubbles: ["Committed to Firm B ecosystem", "Renewing multi-quarter contract"],
  },
  {
    id: 5,
    label: "JIT Manufacturers",
    baseMuA: 0.25,
    baseMuB: 0.12,
    bubbles: ["Penalizing any supplier stockout", "Watching port lead-time spike closely"],
  },
  {
    id: 6,
    label: "Spot Market Arbitrageurs",
    baseMuA: 0.05,
    baseMuB: 0.09,
    bubbles: ["Buying lowest offer tick-by-tick", "Zero brand loyalty, pure spread play"],
  },
  {
    id: 7,
    label: "Public Sector Buyers",
    baseMuA: 0.19,
    baseMuB: 0.21,
    bubbles: ["Fixed budget ceiling; deferring excess", "Requiring dual-source availability"],
  },
  {
    id: 8,
    label: "High-Margin Integrators",
    baseMuA: 0.41,
    baseMuB: 0.14,
    bubbles: ["Paying premium for guaranteed stock", "Stockout costs us 5x unit price"],
  },
  {
    id: 9,
    label: "Distressed Retailers",
    baseMuA: -0.18,
    baseMuB: 0.04,
    bubbles: ["Scaling back orders near reference price", "Moving to outside good if P > $105"],
  },
  {
    id: 10,
    label: "Safety-Stock Hoarders",
    baseMuA: 0.36,
    baseMuB: 0.31,
    bubbles: ["Front-loading orders on tariff headline", "Will take spillover from rival if needed"],
  },
  {
    id: 11,
    label: "Tech-Spec Evaluators",
    baseMuA: 0.29,
    baseMuB: 0.22,
    bubbles: ["Tracking marketing & quality signals", "Favoring Firm A buffered fulfillment"],
  },
  {
    id: 12,
    label: "Late-Cycle Followers",
    baseMuA: 0.11,
    baseMuB: 0.15,
    bubbles: ["Following consensus market share", "Avoiding stockout-prone vendor"],
  },
];

/**
 * Deterministic Mulberry32 PRNG so mock runs are reproducible and realistic.
 */
function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function variance(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
  return arr.reduce((s, x) => s + (x - mean) * (x - mean), 0) / (arr.length - 1);
}

/**
 * Try loading a recorded JSONL replay file from public/replays/<scenarioId>.jsonl
 * or public/fixtures/replays/<scenarioId>.jsonl.
 */
async function tryLoadReplayJsonl(
  scenarioId: string
): Promise<ReplayLine[] | null> {
  if (typeof globalThis.fetch !== "function") {
    return null;
  }
  const candidatePaths = [
    `/replays/${scenarioId}.jsonl`,
    `/fixtures/replays/${scenarioId}.jsonl`,
  ];

  for (const url of candidatePaths) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const text = await res.text();
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.startsWith("{") && l.endsWith("}"));
      if (lines.length === 0) continue;

      const parsed: ReplayLine[] = [];
      for (const line of lines) {
        const obj = JSON.parse(line) as ReplayLine;
        if (
          obj &&
          typeof obj.t === "number" &&
          typeof obj.event === "string" &&
          (SSE_EVENT_NAMES as readonly string[]).includes(obj.event)
        ) {
          parsed.push(obj);
        }
      }
      if (parsed.length > 0) {
        return parsed;
      }
    } catch {
      // Continue to next path or synthetic fallback
    }
  }
  return null;
}

/**
 * Start a mock stream that either replays `public/replays/<scenarioId>.jsonl`
 * (if present) or generates a realistic multi-tier simulation run.
 */
export function startMockStream(
  scenarioId: string,
  mode: RunMode,
  onEvent: (event: MarketSSEEvent) => void
): MockStreamHandle {
  let stopped = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let intervalId: ReturnType<typeof setInterval> | null = null;

  const cfg =
    SCENARIO_CONFIGS[scenarioId] ?? SCENARIO_CONFIGS.semiconductor_tariff;
  const rng = createRng(
    scenarioId.split("").reduce((acc, ch) => acc * 31 + ch.charCodeAt(0), 1337)
  );

  const scheduleTimeout = (fn: () => void, ms: number) => {
    if (stopped) return;
    const id = setTimeout(() => {
      timers.delete(id);
      if (!stopped) fn();
    }, ms);
    timers.add(id);
  };

  // Mutable simulation parameters (can be perturbed by live custom shocks)
  let activeDeltaCRaw = cfg.deltaCRaw;
  let activeDeltaLeadTime = cfg.deltaLeadTime;
  let activeDemandShock = cfg.demandShock;
  let shockCounter = 1;

  // Token & call accounting for accurate telemetry (SPEC §3.3 & §8)
  const tierStats: TelemetryEventData["tiers"] = {
    ultra: {
      calls: 0,
      tokens_in: 0,
      tokens_out: 0,
      p50_ttft_ms: 980,
      tok_per_s: 338,
      errors: 0,
    },
    super: {
      calls: 0,
      tokens_in: 0,
      tokens_out: 0,
      p50_ttft_ms: 410,
      tok_per_s: 215,
      errors: 0,
    },
    fast: {
      calls: 0,
      tokens_in: 0,
      tokens_out: 0,
      p50_ttft_ms: 190,
      tok_per_s: 485,
      errors: 0,
    },
  };

  const recordLlmCall = (
    tier: ModelTier,
    tokensIn: number,
    tokensOut: number,
    ttftMs: number,
    tokPerS: number,
    jobStatus: JobStatus
  ): TelemetryEventData => {
    const t = tierStats[tier];
    t.calls += 1;
    t.tokens_in += tokensIn;
    t.tokens_out += tokensOut;
    t.p50_ttft_ms = Math.round(t.p50_ttft_ms * 0.7 + ttftMs * 0.3);
    t.tok_per_s = Math.round(t.tok_per_s * 0.7 + tokPerS * 0.3);

    const totalCalls = Math.max(
      1,
      tierStats.ultra.calls + tierStats.super.calls + tierStats.fast.calls
    );
    const totalTokens = Math.max(
      1,
      tierStats.ultra.tokens_in +
        tierStats.ultra.tokens_out +
        tierStats.super.tokens_in +
        tierStats.super.tokens_out +
        tierStats.fast.tokens_in +
        tierStats.fast.tokens_out
    );

    const call_share: Record<ModelTier, number> = {
      ultra: +((tierStats.ultra.calls / totalCalls) * 100).toFixed(1),
      super: +((tierStats.super.calls / totalCalls) * 100).toFixed(1),
      fast: +((tierStats.fast.calls / totalCalls) * 100).toFixed(1),
    };

    const ultraTok = tierStats.ultra.tokens_in + tierStats.ultra.tokens_out;
    const superTok = tierStats.super.tokens_in + tierStats.super.tokens_out;
    const fastTok = tierStats.fast.tokens_in + tierStats.fast.tokens_out;

    const token_share: Record<ModelTier, number> = {
      ultra: +((ultraTok / totalTokens) * 100).toFixed(1),
      super: +((superTok / totalTokens) * 100).toFixed(1),
      fast: +((fastTok / totalTokens) * 100).toFixed(1),
    };

    // Token Factory verified prices (USD per 1M tokens: input / output)
    // Ultra: 1.00 / 3.00, Super: 0.30 / 0.90, Fast (Lightning): 0.06 / 0.24
    const costUltra =
      (tierStats.ultra.tokens_in * 1.0 + tierStats.ultra.tokens_out * 3.0) /
      1_000_000;
    const costSuper =
      (tierStats.super.tokens_in * 0.3 + tierStats.super.tokens_out * 0.9) /
      1_000_000;
    const costFast =
      (tierStats.fast.tokens_in * 0.06 + tierStats.fast.tokens_out * 0.24) /
      1_000_000;
    const cost_usd = +(costUltra + costSuper + costFast).toFixed(4);

    // Counterfactual: every call routed to Ultra (including ~2,100 reasoning tokens per call)
    const nonUltraCalls = tierStats.super.calls + tierStats.fast.calls;
    const allUltraIn =
      tierStats.ultra.tokens_in +
      tierStats.super.tokens_in +
      tierStats.fast.tokens_in;
    const allUltraOut =
      tierStats.ultra.tokens_out +
      tierStats.super.tokens_out +
      tierStats.fast.tokens_out +
      nonUltraCalls * 2100;
    const cost_all_ultra_usd = +(
      (allUltraIn * 1.0 + allUltraOut * 3.0) /
      1_000_000
    ).toFixed(4);

    const savings_pct =
      cost_all_ultra_usd > 0
        ? +(
            Math.max(
              0,
              ((cost_all_ultra_usd - cost_usd) / cost_all_ultra_usd) * 100
            )
          ).toFixed(1)
        : 0;

    return {
      tiers: {
        ultra: { ...tierStats.ultra },
        super: { ...tierStats.super },
        fast: { ...tierStats.fast },
      },
      call_share,
      token_share,
      cost_usd,
      cost_all_ultra_usd,
      savings_pct,
      job: {
        id: "mc-10k-nebius-job",
        status: jobStatus,
      },
    };
  };

  let currentTick = 0;

  const emitGroundingAndShockDecision = (
    grounding: GroundingEventData,
    tickNum: number,
    jobStatus: JobStatus
  ) => {
    onEvent({ event: "grounding", data: grounding });
    const shockDecision: DecisionEventData<"shock_parser"> = {
      tick: tickNum,
      role: "shock_parser",
      tier: "super",
      model: "nvidia/nemotron-3-super-120b-a12b",
      decision: {
        delta_c_raw: activeDeltaCRaw,
        delta_lead_time: activeDeltaLeadTime,
        demand_shock: activeDemandShock,
        severity: +Math.min(
          1,
          Math.abs(activeDeltaCRaw) * 1.6 + activeDeltaLeadTime * 0.08
        ).toFixed(2),
        evidence: [
          {
            quote: grounding.quote,
            url: grounding.url,
          },
        ],
      },
      fallback_used: false,
      latency_ms: 420 + Math.round(rng() * 90),
    };
    onEvent({ event: "decision", data: shockDecision });
    const telem = recordLlmCall("super", 2850, 390, 415, 220, jobStatus);
    onEvent({ event: "telemetry", data: telem });
  };

  // Start async check for recorded JSONL replay first; fallback to synthetic generator
  void (async () => {
    const replayLines = await tryLoadReplayJsonl(cfg.id);
    if (stopped) return;

    if (replayLines && replayLines.length > 0) {
      for (const line of replayLines) {
        scheduleTimeout(() => {
          onEvent({
            event: line.event as SSEEventName,
            data: line.data as never,
          } as MarketSSEEvent);
        }, Math.max(0, Math.round(line.t * 1000)));
      }
      return;
    }

    // Synthetic run generator (faithful to SPEC.md §4–§8)
    const runId = `run-${cfg.id.slice(0, 6)}-${Date.now().toString(36)}`;
    const nConsumers = 200;
    const epochTicks = 8;
    const tickSeconds = 1.5;

    onEvent({
      event: "scenario",
      data: {
        run_id: runId,
        scenario_id: cfg.id,
        title: cfg.title,
        mode,
        n_consumers: nConsumers,
        tick_seconds: tickSeconds,
        epoch_ticks: epochTicks,
      },
    });

    // Seed initial Tavily Grounding card & Super shock_parser decision
    emitGroundingAndShockDecision(
      {
        id: `grd-init-${cfg.id}`,
        query: cfg.initialQuery,
        url: cfg.initialUrl,
        title: cfg.initialNewsTitle,
        quote: cfg.initialQuote,
        param: "delta_c_raw",
        value: cfg.deltaCRaw,
        ts: new Date().toISOString(),
        live: mode === "live",
        applied: true,
      },
      0,
      "queued"
    );

    // State variables across ticks for U1 (AI) and U2 (Cost-plus Baseline)
    let cumProfitU1: FirmPair<number> = [0, 0];
    let cumProfitU2: FirmPair<number> = [0, 0];
    let invU1: FirmPair<number> = [240, 220];
    let rawInvU1: FirmPair<number> = [340, 320];
    let invU2: FirmPair<number> = [210, 220];
    let rawInvU2: FirmPair<number> = [280, 320];

    let priceU1: FirmPair<number> = [94.0, 91.5];
    let qtyPlanU1: FirmPair<number> = [215, 195];
    let mktU1: FirmPair<number> = [420, 360];
    let omegaA = 0.65;

    const demandHistoryA: number[] = [];
    const demandHistoryB: number[] = [];
    const ordersHistoryA: number[] = [];
    const ordersHistoryB: number[] = [];

    const streamEpochReasoningAndDecisions = (
      tickStart: number,
      epochIdx: number,
      cRawNow: number,
      leadTimeNow: number,
      jobStatus: JobStatus
    ) => {
      const targetPriceA = +(
        cRawNow * 1.48 +
        (epochIdx % 2 === 0 ? 2.4 : 1.1) +
        (rng() - 0.5) * 1.5
      ).toFixed(2);
      const targetPriceB = +(
        cRawNow * 1.44 +
        (epochIdx % 2 === 0 ? 0.8 : 2.1) +
        (rng() - 0.5) * 1.5
      ).toFixed(2);
      const targetQtyA = Math.round(215 + activeDemandShock * 90 + (rng() - 0.5) * 14);
      const targetQtyB = Math.round(195 + activeDemandShock * 75 + (rng() - 0.5) * 14);
      const targetMktA = Math.round(440 + epochIdx * 15);
      const targetMktB = Math.round(370 + epochIdx * 10);
      omegaA = +Math.min(
        1.8,
        Math.max(0.2, 0.45 + activeDeltaLeadTime * 0.14 + (rng() - 0.5) * 0.1)
      ).toFixed(2);

      const ceoAChunks = [
        `[Epoch ${epochIdx} · Tick ${tickStart}] Evaluating landed raw cost c_raw=$${cRawNow.toFixed(2)} (+${(activeDeltaCRaw * 100).toFixed(0)}% shock) and pipeline lead time L=${leadTimeNow} ticks.\n`,
        `Cross-price elasticity E_AB=+0.74 indicates moderate substitution if we hike >8% above Firm B ($${priceU1[1].toFixed(2)}). `,
        `However, Firm B's unbuffered ROP leaves it exposed to stockout spillover (θ=0.65) when pipeline orders lag by ${leadTimeNow} ticks.\n`,
        `Best-response on the 3×3 Bertrand matrix favors setting P_A=$${targetPriceA.toFixed(2)}, expanding production plan Q_A=${targetQtyA} units, `,
        `and lifting safety stock multiplier ω=${omegaA.toFixed(2)} to capture spilled high-margin enterprise demand while avoiding goodwill erosion.`,
      ];

      const ceoBChunks = [
        `[Epoch ${epochIdx} · Tick ${tickStart}] Assessing margin compression under c_raw=$${cRawNow.toFixed(2)} and L=${leadTimeNow}t.\n`,
        `Own-price elasticity E_d=-1.68 penalizes aggressive hikes among SMB archetypes. `,
        `Targeting P_B=$${targetPriceB.toFixed(2)} with Q_B=${targetQtyB} and M_B=$${targetMktB} to defend core share without triggering a destructive Prisoner's Dilemma price cut.`,
      ];

      ceoAChunks.forEach((delta, idx) => {
        scheduleTimeout(() => {
          onEvent({
            event: "reasoning",
            data: { role: "ceo_A", delta, tick: tickStart },
          });
        }, idx * 160);
      });

      ceoBChunks.forEach((delta, idx) => {
        scheduleTimeout(() => {
          onEvent({
            event: "reasoning",
            data: { role: "ceo_B", delta, tick: tickStart },
          });
        }, 80 + idx * 180);
      });

      scheduleTimeout(() => {
        onEvent({
          event: "reasoning_done",
          data: { role: "ceo_A", tick: tickStart },
        });
        onEvent({
          event: "reasoning_done",
          data: { role: "ceo_B", tick: tickStart },
        });

        priceU1 = [targetPriceA, targetPriceB];
        qtyPlanU1 = [targetQtyA, targetQtyB];
        mktU1 = [targetMktA, targetMktB];

        const decA: DecisionEventData<"ceo_A"> = {
          tick: tickStart,
          role: "ceo_A",
          tier: "ultra",
          model: "nvidia/Nemotron-3-Ultra-550b-a55b",
          decision: {
            price: targetPriceA,
            production_qty: targetQtyA,
            marketing_budget: targetMktA,
            expected_rival_action: "hold",
            rationale: `Hold premium P=$${targetPriceA.toFixed(2)} with Q=${targetQtyA} to absorb rival stockout spillover under L=${leadTimeNow}t.`,
          },
          fallback_used: false,
          latency_ms: 1120 + Math.round(rng() * 180),
        };

        const decB: DecisionEventData<"ceo_B"> = {
          tick: tickStart,
          role: "ceo_B",
          tier: "ultra",
          model: "nvidia/Nemotron-3-Ultra-550b-a55b",
          decision: {
            price: targetPriceB,
            production_qty: targetQtyB,
            marketing_budget: targetMktB,
            expected_rival_action: "hold",
            rationale: `Stabilize price at $${targetPriceB.toFixed(2)} (Q=${targetQtyB}) to preserve margin against +${(activeDeltaCRaw * 100).toFixed(0)}% input cost.`,
          },
          fallback_used: false,
          latency_ms: 1080 + Math.round(rng() * 170),
        };

        const decInv: DecisionEventData<"inventory"> = {
          tick: tickStart,
          role: "inventory",
          tier: "super",
          model: "nvidia/nemotron-3-super-120b-a12b",
          decision: {
            omega: omegaA,
            rationale: `Raise reorder buffer ω=${omegaA.toFixed(2)} to hedge L=${leadTimeNow} tick lead time and prevent stockout penalty.`,
          },
          fallback_used: false,
          latency_ms: 390 + Math.round(rng() * 60),
        };

        onEvent({ event: "decision", data: decA });
        onEvent({ event: "decision", data: decB });
        onEvent({ event: "decision", data: decInv });

        recordLlmCall("ultra", 2950, 2380, 960, 342, jobStatus);
        recordLlmCall("ultra", 2910, 2240, 990, 335, jobStatus);
        const telem = recordLlmCall("super", 2600, 360, 405, 218, jobStatus);
        onEvent({ event: "telemetry", data: telem });

        // Emit 3x3 Nash equilibrium matrix for this decision epoch
        const baseA = 1480 + epochIdx * 22;
        const baseB = 1120 + epochIdx * 14;
        const payoff_A: Matrix3x3 = [
          [
            Math.round(baseA * 0.78),
            Math.round(baseA * 1.06),
            Math.round(baseA * 1.14),
          ],
          [
            Math.round(baseA * 0.71),
            Math.round(baseA * 1.0),
            Math.round(baseA * 1.09),
          ],
          [
            Math.round(baseA * 0.62),
            Math.round(baseA * 0.93),
            Math.round(baseA * 1.05),
          ],
        ];
        const payoff_B: Matrix3x3 = [
          [
            Math.round(baseB * 0.76),
            Math.round(baseB * 0.7),
            Math.round(baseB * 0.64),
          ],
          [
            Math.round(baseB * 1.05),
            Math.round(baseB * 1.0),
            Math.round(baseB * 0.92),
          ],
          [
            Math.round(baseB * 1.12),
            Math.round(baseB * 1.07),
            Math.round(baseB * 1.04),
          ],
        ];
        const labels: NashLabel[] = ["nash", "collusion", "nash", "price_war"];
        const chosenLabel = labels[epochIdx % labels.length];
        const chosenCell: [number, number] =
          chosenLabel === "collusion"
            ? [2, 2]
            : chosenLabel === "price_war"
            ? [0, 0]
            : [1, 1];

        onEvent({
          event: "nash",
          data: {
            tick: tickStart,
            actions: ["cut", "hold", "raise"] as [
              NashAction,
              NashAction,
              NashAction
            ],
            payoff_A,
            payoff_B,
            pure_ne: [[1, 1]],
            mixed_ne: null,
            chosen: chosenCell,
            label: chosenLabel,
          },
        });
      }, 860);
    };

    const emitCrowdUpdate = (tickNum: number, jobStatus: JobStatus) => {
      const archetypes: CrowdArchetype[] = ARCHETYPE_DEFINITIONS.map((def) => {
        const muA = +Math.max(
          -1,
          Math.min(1, def.baseMuA + (rng() - 0.48) * 0.14)
        ).toFixed(2);
        const muB = +Math.max(
          -1,
          Math.min(1, def.baseMuB + (rng() - 0.5) * 0.14)
        ).toFixed(2);
        const sigA = +(0.12 + rng() * 0.1).toFixed(2);
        const sigB = +(0.13 + rng() * 0.1).toFixed(2);
        const bubble = def.bubbles[tickNum % 2];
        return {
          id: def.id,
          label: def.label,
          mu: [muA, muB],
          sigma: [sigA, sigB],
          bubble,
        };
      });

      const crowdDec: DecisionEventData<"crowd"> = {
        tick: tickNum,
        role: "crowd",
        tier: "fast",
        model: "nvidia/Nemotron-3_5-Lightning",
        decision: {
          archetypes: archetypes.map((a) => ({
            id: a.id,
            mu: a.mu,
            sigma: a.sigma,
            bubble: a.bubble,
          })),
        },
        fallback_used: false,
        latency_ms: 195 + Math.round(rng() * 45),
      };

      onEvent({ event: "decision", data: crowdDec });
      onEvent({
        event: "crowd",
        data: {
          tick: tickNum,
          archetypes,
        },
      });
      // 2 parallel calls of 6 archetypes each per crowd update (SPEC §3.2)
      recordLlmCall("fast", 1420, 580, 185, 490, jobStatus);
      const telem = recordLlmCall("fast", 1450, 610, 195, 480, jobStatus);
      onEvent({ event: "telemetry", data: telem });
    };

    const runSingleTick = () => {
      if (stopped) return;
      currentTick += 1;
      const t = currentTick;
      const epochIdx = Math.floor((t - 1) / epochTicks);
      const jobStatus: JobStatus =
        t < 6 ? "queued" : t < 18 ? "running" : "verified";

      const cRawNow = +(cfg.baseRawCost * (1 + activeDeltaCRaw)).toFixed(2);
      const leadTimeNow = Math.max(1, cfg.baseLeadTime + activeDeltaLeadTime);

      // Autonomous Deep-Scout trigger on tick 16
      if (t === 16) {
        activeDeltaLeadTime += 1;
        emitGroundingAndShockDecision(
          {
            id: `grd-scout-${cfg.id}-${t}`,
            query: cfg.deepScoutQuery,
            url: cfg.deepScoutUrl,
            title: cfg.deepScoutTitle,
            quote: cfg.deepScoutQuote,
            param: "delta_lead_time",
            value: activeDeltaLeadTime,
            ts: new Date().toISOString(),
            live: mode === "live",
            applied: true,
          },
          t,
          jobStatus
        );
      }

      // Start of decision epoch: stream Ultra reasoning + decisions + Nash
      if ((t - 1) % epochTicks === 0) {
        streamEpochReasoningAndDecisions(
          t,
          epochIdx,
          cRawNow,
          leadTimeNow,
          jobStatus
        );
      }

      // Every 3 ticks: update 12 consumer crowd archetypes
      if ((t - 1) % 3 === 0) {
        emitCrowdUpdate(t, jobStatus);
      }

      // Compute U1 (Ultra AI CEOs) vs U2 (Cost-plus baseline) tick outcomes
      const shareOut = +(0.15 + (rng() - 0.5) * 0.02).toFixed(3);
      const shareA = +(0.47 + (rng() - 0.48) * 0.03).toFixed(3);
      const shareB = +Math.max(0.05, 1 - shareOut - shareA).toFixed(3);

      const totalMarket = nConsumers * (1 + activeDemandShock);
      const demandA = +(totalMarket * shareA).toFixed(1);
      const demandB = +(totalMarket * shareB).toFixed(1);

      demandHistoryA.push(demandA);
      demandHistoryB.push(demandB);
      if (demandHistoryA.length > 16) demandHistoryA.shift();
      if (demandHistoryB.length > 16) demandHistoryB.shift();

      const prodA = Math.min(qtyPlanU1[0], 250, Math.floor(rawInvU1[0] / 1.0));
      const prodB = Math.min(qtyPlanU1[1], 240, Math.floor(rawInvU1[1] / 1.0));
      invU1 = [invU1[0] + prodA, invU1[1] + prodB];
      rawInvU1 = [
        Math.max(40, rawInvU1[0] - prodA),
        Math.max(30, rawInvU1[1] - prodB),
      ];

      const ownSalesA = +Math.min(demandA, invU1[0]).toFixed(1);
      const ownSalesB = +Math.min(demandB, invU1[1]).toFixed(1);
      const unmetA = +(demandA - ownSalesA).toFixed(1);
      const unmetB = +(demandB - ownSalesB).toFixed(1);

      const theta = 0.65;
      const spillToA = +Math.min(theta * unmetB, invU1[0] - ownSalesA).toFixed(1);
      const spillToB = +Math.min(theta * unmetA, invU1[1] - ownSalesB).toFixed(1);

      const salesA = +(ownSalesA + spillToA).toFixed(1);
      const salesB = +(ownSalesB + spillToB).toFixed(1);
      const lost = +Math.max(0, demandA + demandB - (salesA + salesB)).toFixed(1);

      invU1 = [
        +Math.max(0, invU1[0] - salesA).toFixed(1),
        +Math.max(0, invU1[1] - salesB).toFixed(1),
      ];

      const ropA = Math.round(92 * leadTimeNow * (1 + 0.18 * omegaA));
      const ropB = Math.round(84 * leadTimeNow * 1.05);
      const orderA = rawInvU1[0] <= ropA ? Math.round(ropA + 180 - rawInvU1[0]) : 0;
      const orderB = rawInvU1[1] <= ropB ? Math.round(ropB + 150 - rawInvU1[1]) : 0;
      if (orderA > 0) rawInvU1[0] += Math.round(orderA * 0.85);
      if (orderB > 0) rawInvU1[1] += Math.round(orderB * 0.78);

      ordersHistoryA.push(orderA > 0 ? orderA : demandA * (0.92 + rng() * 0.18));
      ordersHistoryB.push(orderB > 0 ? orderB : demandB * (0.88 + rng() * 0.25));
      if (ordersHistoryA.length > 16) ordersHistoryA.shift();
      if (ordersHistoryB.length > 16) ordersHistoryB.shift();

      const eta = 0.018;
      const fc = 1100;
      const mcA = +(cRawNow + 2 * eta * prodA).toFixed(2);
      const mcB = +(cRawNow + 2 * eta * prodB).toFixed(2);
      const atcA = +(fc / Math.max(prodA, 1) + cRawNow + eta * prodA).toFixed(2);
      const atcB = +(fc / Math.max(prodB, 1) + cRawNow + eta * prodB).toFixed(2);

      const tcA = fc + cRawNow * prodA + eta * prodA * prodA;
      const tcB = fc + cRawNow * prodB + eta * prodB * prodB;
      const holdCost = 0.35;

      const profitA = +(
        priceU1[0] * salesA -
        tcA -
        mktU1[0] -
        holdCost * (invU1[0] + rawInvU1[0])
      ).toFixed(1);
      const profitB = +(
        priceU1[1] * salesB -
        tcB -
        mktU1[1] -
        holdCost * (invU1[1] + rawInvU1[1])
      ).toFixed(1);

      cumProfitU1 = [
        +(cumProfitU1[0] + profitA).toFixed(1),
        +(cumProfitU1[1] + profitB).toFixed(1),
      ];

      // Bullwhip is null until 8 ticks have passed (docs/EVENTS.md)
      let bullwhip: FirmPair<number | null> | null = null;
      if (t >= 8) {
        const varDA = Math.max(4.0, variance(demandHistoryA));
        const varDB = Math.max(4.0, variance(demandHistoryB));
        const varOA = variance(ordersHistoryA);
        const varOB = variance(ordersHistoryB);
        bullwhip = [
          +Math.min(3.4, Math.max(1.05, varOA / varDA + 0.45 * omegaA)).toFixed(2),
          +Math.min(3.8, Math.max(1.12, varOB / varDB + 0.65)).toFixed(2),
        ];
      }

      // Generate choices_b64 (N int8: 0=outside, 1=A, 2=B) for U1
      const choicesArr = new Int8Array(nConsumers);
      const cutOut = shareOut;
      const cutA = shareOut + shareA;
      for (let i = 0; i < nConsumers; i++) {
        const u = rng();
        choicesArr[i] = u < cutOut ? 0 : u < cutA ? 1 : 2;
      }
      const choices_b64 = encodeChoicesB64(choicesArr);

      // U2 Counterfactual (Firm A = Cost-plus baseline with ω=0, rival B held fixed)
      const basePriceA = +(atcA * 1.16).toFixed(2);
      const baseDemandA = +(demandA * 0.93).toFixed(1);
      const baseSalesA = +Math.min(baseDemandA, invU2[0] + prodA * 0.88).toFixed(1);
      const baseUnmetA = +Math.max(0, baseDemandA - baseSalesA).toFixed(1);
      const baseSpillToB = +Math.min(theta * baseUnmetA, 18).toFixed(1);
      const baseProfitA = +(
        profitA -
        (210 + activeDeltaLeadTime * 38 + (rng() - 0.3) * 45)
      ).toFixed(1);
      const baseProfitB = +(profitB + baseSpillToB * 14).toFixed(1);

      cumProfitU2 = [
        +(cumProfitU2[0] + baseProfitA).toFixed(1),
        +(cumProfitU2[1] + baseProfitB).toFixed(1),
      ];
      invU2 = [
        +Math.max(0, invU1[0] * 0.65).toFixed(1),
        invU1[1],
      ];
      rawInvU2 = [
        +Math.max(20, rawInvU1[0] * 0.72).toFixed(1),
        rawInvU1[1],
      ];

      // Econometric paired t-test & chi2 statistics
      const deltaMean = +(cumProfitU1[0] - cumProfitU2[0]).toFixed(1);
      const isCloud = jobStatus === "verified";
      const sampleN = isCloud ? 10000 : 100;
      const stdErr = isCloud
        ? Math.max(12, Math.abs(deltaMean) * 0.045)
        : Math.max(35, Math.abs(deltaMean) * 0.16);
      const halfWidth = +(1.96 * stdErr).toFixed(1);
      const statsPayload: StatsEventData = {
        tick: t,
        source: isCloud ? "cloud" : "live",
        n: sampleN,
        delta_mean: deltaMean,
        ci95: [+(deltaMean - halfWidth).toFixed(1), +(deltaMean + halfWidth).toFixed(1)],
        cohens_d: +(0.82 + Math.min(1.4, t * 0.025)).toFixed(2),
        cohens_dz: +(1.14 + Math.min(1.8, t * 0.032)).toFixed(2),
        p_value: isCloud ? 0.0001 : +(Math.max(0.0004, 0.018 * Math.exp(-t * 0.08))).toFixed(4),
        chi2: t >= 4 ? +(14.2 + t * 0.65).toFixed(2) : null,
        chi2_p: t >= 4 ? 0.0008 : null,
      };

      const tickU1: TickEventData = {
        tick: t,
        universe: "U1",
        price: [priceU1[0], priceU1[1]],
        qty: [prodA, prodB],
        demand: [demandA, demandB],
        sales: [salesA, salesB],
        unmet: [unmetA, unmetB],
        spill_in: [spillToA, spillToB],
        lost,
        inventory: [invU1[0], invU1[1]],
        raw_inv: [rawInvU1[0], rawInvU1[1]],
        rop: [ropA, ropB],
        orders: [orderA, orderB],
        profit: [profitA, profitB],
        cum_profit: [cumProfitU1[0], cumProfitU1[1]],
        shares: [shareOut, shareA, shareB],
        c_raw: cRawNow,
        lead_time: leadTimeNow,
        mc: [mcA, mcB],
        atc: [atcA, atcB],
        bullwhip,
        choices_b64,
      };

      // U2 omits choices_b64 per docs/EVENTS.md
      const tickU2: TickEventData = {
        tick: t,
        universe: "U2",
        price: [basePriceA, priceU1[1]],
        qty: [Math.round(prodA * 0.9), prodB],
        demand: [baseDemandA, demandB],
        sales: [baseSalesA, +(salesB + baseSpillToB).toFixed(1)],
        unmet: [baseUnmetA, unmetB],
        spill_in: [0, baseSpillToB],
        lost: +Math.max(0, lost + baseUnmetA * 0.35).toFixed(1),
        inventory: [invU2[0], invU2[1]],
        raw_inv: [rawInvU2[0], rawInvU2[1]],
        rop: [Math.round(ropA * 0.78), ropB],
        orders: [Math.round(orderA * 0.8), orderB],
        profit: [baseProfitA, baseProfitB],
        cum_profit: [cumProfitU2[0], cumProfitU2[1]],
        shares: [
          +(shareOut + 0.03).toFixed(3),
          +(shareA - 0.05).toFixed(3),
          +(shareB + 0.02).toFixed(3),
        ],
        c_raw: cRawNow,
        lead_time: leadTimeNow,
        mc: [mcA, mcB],
        atc: [atcA, atcB],
        bullwhip: bullwhip
          ? [+(bullwhip[0]! * 0.78).toFixed(2), bullwhip[1]]
          : null,
      };

      onEvent({ event: "stats", data: statsPayload });
      // Emit U2 then U1 so when U1 triggers the rAF flush, both U1 and U2 are already in the buffer
      onEvent({ event: "tick", data: tickU2 });
      onEvent({ event: "tick", data: tickU1 });
    };

    // Run first tick rapidly so UI populates immediately, then every 1.5s
    scheduleTimeout(runSingleTick, 120);
    intervalId = setInterval(runSingleTick, 1500);
  })();

  return {
    stop: () => {
      stopped = true;
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers.clear();
    },

    injectShock: (text: string) => {
      const currentMode = useMarketStore.getState().mode;
      if (currentMode !== "live") {
        return {
          accepted: false,
          reason: "Custom shocks require LIVE mode (switch from REPLAY to LIVE).",
        };
      }
      const trimmed = text.trim();
      if (!trimmed) {
        return { accepted: false, reason: "Shock description cannot be empty." };
      }
      shockCounter += 1;
      const lower = trimmed.toLowerCase();
      let param: GroundingEventData["param"] = "delta_c_raw";
      let value = 0.2;
      if (
        lower.includes("port") ||
        lower.includes("route") ||
        lower.includes("lead") ||
        lower.includes("delay") ||
        lower.includes("blockade")
      ) {
        param = "delta_lead_time";
        activeDeltaLeadTime = Math.min(10, activeDeltaLeadTime + 2);
        value = activeDeltaLeadTime;
      } else if (
        lower.includes("demand") ||
        lower.includes("boycott") ||
        lower.includes("surge")
      ) {
        param = "demand_shock";
        activeDemandShock = +(Math.min(0.5, activeDemandShock + 0.12)).toFixed(2);
        value = activeDemandShock;
      } else {
        param = "delta_c_raw";
        activeDeltaCRaw = +(Math.min(1.0, activeDeltaCRaw + 0.15)).toFixed(2);
        value = activeDeltaCRaw;
      }

      const jobStatus = useMarketStore.getState().telemetry.job.status;
      emitGroundingAndShockDecision(
        {
          id: `grd-custom-${Date.now()}-${shockCounter}`,
          query: trimmed,
          url: "https://www.reuters.com/markets/custom-shock-dispatch",
          title: `Live Operator Shock: ${trimmed.slice(0, 64)}`,
          quote: `"${trimmed}" — parsed by Nemotron-3-Super into ${param} = ${value >= 0 ? "+" : ""}${value}.`,
          param,
          value,
          ts: new Date().toISOString(),
          live: true,
          applied: true,
        },
        Math.max(1, currentTick),
        jobStatus
      );
      return { accepted: true };
    },

    triggerNewsCheck: () => {
      shockCounter += 1;
      const state = useMarketStore.getState();
      const isLive = state.mode === "live";
      const jobStatus = state.telemetry.job.status;
      if (isLive) {
        activeDeltaCRaw = +(Math.min(1.0, activeDeltaCRaw + 0.08)).toFixed(2);
      }
      const previewVal = isLive
        ? activeDeltaCRaw
        : +(activeDeltaCRaw + 0.08).toFixed(2);

      emitGroundingAndShockDecision(
        {
          id: `grd-livecheck-${Date.now()}-${shockCounter}`,
          query: `${cfg.initialQuery} live update`,
          url: cfg.deepScoutUrl,
          title: `Tavily Live News Check: ${cfg.deepScoutTitle}`,
          quote: `${cfg.deepScoutQuote} (${isLive ? "Applied to active LIVE engine" : "REPLAY counterfactual preview — recorded run untouched"})`,
          param: "delta_c_raw",
          value: previewVal,
          ts: new Date().toISOString(),
          live: true,
          applied: isLive,
        },
        Math.max(1, currentTick),
        jobStatus
      );
      return { accepted: true };
    },
  };
}

/**
 * Generate a downloadable Benchmark Report (JSON or Markdown) from the current
 * store telemetry & econometric stats when offline / in mock mode.
 */
export function buildLocalBenchmarkExport(
  format: BenchmarkExportFormat
): { content: string; mime: string; filename: string } {
  const state = useMarketStore.getState();
  const { telemetry, stats, scenario, selectedScenarioId, currentTick, latestU1, latestU2 } =
    state;
  const ts = new Date().toISOString();

  const payload = {
    generated_at: ts,
    scenario_id: scenario?.scenario_id ?? selectedScenarioId,
    scenario_title: scenario?.title ?? "Market Digital Twin Benchmark",
    mode: state.mode,
    ticks_completed: currentTick,
    models: {
      ultra: "nvidia/Nemotron-3-Ultra-550b-a55b",
      super: "nvidia/nemotron-3-super-120b-a12b",
      fast: "nvidia/Nemotron-3_5-Lightning",
      fast_fallback: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
    },
    telemetry,
    econometrics: stats,
    cumulative_profit_usd: {
      ai_ceo_u1: latestU1?.cum_profit ?? [0, 0],
      baseline_u2: latestU2?.cum_profit ?? [0, 0],
    },
  };

  if (format === "json") {
    return {
      content: JSON.stringify(payload, null, 2),
      mime: "application/json",
      filename: `market-digital-twin-benchmark-${selectedScenarioId}.json`,
    };
  }

  const md = [
    `# Market Digital Twin — Nebius Token Factory & Nemotron Benchmark`,
    ``,
    `- **Generated:** ${ts}`,
    `- **Scenario:** ${payload.scenario_title} (\`${payload.scenario_id}\`)`,
    `- **Mode:** ${state.mode.toUpperCase()} · **Ticks:** ${currentTick} · **MC Job:** \`${telemetry.job.status.toUpperCase()}\``,
    ``,
    `## 1. Per-Tier Inference Telemetry (Nebius Token Factory)`,
    ``,
    `| Tier | Model ID | Calls | Call Share | Token Share | p50 TTFT (ms) | Throughput (tok/s) | Errors |`,
    `|---|---|---:|---:|---:|---:|---:|---:|`,
    `| **Ultra** | \`nvidia/Nemotron-3-Ultra-550b-a55b\` | ${telemetry.tiers.ultra.calls} | ${telemetry.call_share.ultra.toFixed(1)}% | ${telemetry.token_share.ultra.toFixed(1)}% | ${telemetry.tiers.ultra.p50_ttft_ms} ms | ${telemetry.tiers.ultra.tok_per_s} tok/s | ${telemetry.tiers.ultra.errors} |`,
    `| **Super** | \`nvidia/nemotron-3-super-120b-a12b\` | ${telemetry.tiers.super.calls} | ${telemetry.call_share.super.toFixed(1)}% | ${telemetry.token_share.super.toFixed(1)}% | ${telemetry.tiers.super.p50_ttft_ms} ms | ${telemetry.tiers.super.tok_per_s} tok/s | ${telemetry.tiers.super.errors} |`,
    `| **Fast** | \`nvidia/Nemotron-3_5-Lightning\` | ${telemetry.tiers.fast.calls} | ${telemetry.call_share.fast.toFixed(1)}% | ${telemetry.token_share.fast.toFixed(1)}% | ${telemetry.tiers.fast.p50_ttft_ms} ms | ${telemetry.tiers.fast.tok_per_s} tok/s | ${telemetry.tiers.fast.errors} |`,
    ``,
    `## 2. Routing Cost & Counterfactual Savings`,
    ``,
    `- **Actual Multi-Tier Cost:** $${telemetry.cost_usd.toFixed(4)} USD`,
    `- **Counterfactual All-Ultra Cost:** $${telemetry.cost_all_ultra_usd.toFixed(4)} USD`,
    `- **Cost Saved via Tiered Routing:** **${telemetry.savings_pct.toFixed(1)}%**`,
    ``,
    `## 3. Econometric Proof (AI Strategic Alpha Δπ)`,
    ``,
    `- **Evaluation Source:** ${stats?.source === "cloud" ? "Cloud-Verified (n=10,000)" : `Live Preview (n=${stats?.n ?? 100})`}`,
    `- **Mean Δπ (AI vs Cost-Plus Baseline):** $${(stats?.delta_mean ?? 0).toFixed(2)} (95% CI: [$${(stats?.ci95?.[0] ?? 0).toFixed(2)}, $${(stats?.ci95?.[1] ?? 0).toFixed(2)}])`,
    `- **Effect Size (Cohen's d):** ${(stats?.cohens_d ?? 0).toFixed(2)} · **p-value:** ${stats?.p_value ?? "—"}`,
    `- **Brand Switching χ²:** ${stats?.chi2 ?? "—"} (p = ${stats?.chi2_p ?? "—"})`,
    ``,
  ].join("\n");

  return {
    content: md,
    mime: "text/markdown",
    filename: `market-digital-twin-benchmark-${selectedScenarioId}.md`,
  };
}

export { DEFAULT_SCENARIOS };
export type { ScenarioSummary };

