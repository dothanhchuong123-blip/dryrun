import { create } from "zustand";
import {
  CrowdArchetype,
  CrowdEventData,
  DecisionEventData,
  DecisionRole,
  ErrorEventData,
  FirmPair,
  GroundingEventData,
  MarketSSEEvent,
  ModelTier,
  NashEventData,
  NewsCheckResponse,
  RunMode,
  ScenarioEventData,
  ScenarioSummary,
  ShockResponse,
  StatsEventData,
  TelemetryEventData,
  TickEventData,
  decodeChoicesB64,
} from "./events";

export const MAX_ROLLING_TICKS = 120;

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "mock"
  | "error";

export interface CombinedTickPoint {
  tick: number;
  u1: TickEventData;
  u2: TickEventData | null;
  stats: StatsEventData | null;
}

export interface ReasoningStreamEntry {
  id: string;
  epoch: number;
  tick: number;
  role: DecisionRole | string;
  tier: ModelTier;
  model: string;
  text: string;
  done: boolean;
  decision?: DecisionEventData;
  updatedAt: number;
}

export interface EpochReasoningGroup {
  epoch: number;
  startTick: number;
  endTick: number;
  entries: ReasoningStreamEntry[];
}

export interface ChoicesBufferRef {
  current: Int8Array;
  tick: number;
  nConsumers: number;
}

/**
 * Shared non-React TypedArray reference for consumer choices (0=outside, 1=A, 2=B).
 * Updated immediately upon receiving a U1 tick so the Canvas Arena (T12) can read
 * sprite destinations at 60 FPS inside requestAnimationFrame without React state updates.
 */
export const choicesRef: ChoicesBufferRef = {
  current: new Int8Array(200),
  tick: 0,
  nConsumers: 200,
};

export function getChoicesArray(): Int8Array {
  return choicesRef.current;
}

export const DEFAULT_SCENARIOS: ScenarioSummary[] = [
  {
    id: "semiconductor_tariff",
    title: "25% Semiconductor & Wafer Tariff Shock",
    subtitle:
      "US–Asia logic wafer duties hike raw material costs +25% and extend port customs lead time +3 ticks",
    has_replay: true,
  },
  {
    id: "red_sea_blockade",
    title: "Red Sea / Suez Maritime Route Closure",
    subtitle:
      "Cape of Good Hope rerouting spikes freight lead times +5 ticks and raises landed unit cost +18%",
    has_replay: true,
  },
  {
    id: "lithium_spot_spike",
    title: "Lithium Carbonate Spot Price Surge & Demand Shift",
    subtitle:
      "Refinery outage triggers +35% raw input shock alongside +12% precautionary buyer demand surge",
    has_replay: true,
  },
];

export function createInitialTelemetry(): TelemetryEventData {
  return {
    tiers: {
      ultra: {
        calls: 0,
        tokens_in: 0,
        tokens_out: 0,
        p50_ttft_ms: 0,
        tok_per_s: 0,
        errors: 0,
      },
      super: {
        calls: 0,
        tokens_in: 0,
        tokens_out: 0,
        p50_ttft_ms: 0,
        tok_per_s: 0,
        errors: 0,
      },
      fast: {
        calls: 0,
        tokens_in: 0,
        tokens_out: 0,
        p50_ttft_ms: 0,
        tok_per_s: 0,
        errors: 0,
      },
    },
    call_share: {
      ultra: 0,
      super: 0,
      fast: 0,
    },
    token_share: {
      ultra: 0,
      super: 0,
      fast: 0,
    },
    cost_usd: 0,
    cost_all_ultra_usd: 0,
    savings_pct: 0,
    job: {
      id: null,
      status: "idle",
    },
  };
}

export function roleToTier(role: DecisionRole | string): ModelTier {
  if (role === "ceo_A" || role === "ceo_B") return "ultra";
  if (role === "inventory" || role === "shock_parser") return "super";
  return "fast";
}

export function roleToDefaultModel(role: DecisionRole | string): string {
  const tier = roleToTier(role);
  if (tier === "ultra") return "nvidia/Nemotron-3-Ultra-550b-a55b";
  if (tier === "super") return "nvidia/nemotron-3-super-120b-a12b";
  return "nvidia/Nemotron-3_5-Lightning";
}

interface StreamActionDelegates {
  submitShock?: (text: string) => Promise<ShockResponse>;
  triggerNewsCheck?: () => Promise<NewsCheckResponse>;
}

const actionDelegates: StreamActionDelegates = {};

export function registerStreamActionDelegates(
  delegates: StreamActionDelegates
): void {
  Object.assign(actionDelegates, delegates);
}

export interface MarketStoreState {
  // Scenario & connection metadata
  scenarios: ScenarioSummary[];
  selectedScenarioId: string;
  scenario: ScenarioEventData | null;
  runId: string | null;
  mode: RunMode;
  modeReason: string | null;
  connectionStatus: ConnectionStatus;
  usingMock: boolean;

  // Tick & Epoch counters
  currentTick: number;
  currentEpoch: number;
  epochTicks: number;
  tickSeconds: number;
  nConsumers: number;

  // Rolling 120-tick series & latest snapshots
  ticksU1: TickEventData[];
  ticksU2: TickEventData[];
  u1Series: TickEventData[];
  u2Series: TickEventData[];
  tickSeries: CombinedTickPoint[];
  history: CombinedTickPoint[];
  latestU1: TickEventData | null;
  latestU2: TickEventData | null;
  spilloverTotal: FirmPair<number>;

  // Non-React TypedArray reference for Arena sprites
  choicesRef: ChoicesBufferRef;

  // Agent decisions & epoch-grouped reasoning stream
  decisions: DecisionEventData[];
  latestDecisions: Partial<Record<DecisionRole, DecisionEventData>>;
  reasoningGroups: EpochReasoningGroup[];
  activeReasoningRoles: Record<string, boolean>;

  // Grounding, Crowd, Nash, Stats, Telemetry, Errors
  groundings: GroundingEventData[];
  groundingCards: GroundingEventData[];
  crowd: CrowdEventData | null;
  archetypes: CrowdArchetype[];
  nash: NashEventData | null;
  stats: StatsEventData | null;
  statsHistory: StatsEventData[];
  telemetry: TelemetryEventData;
  lastError: ErrorEventData | null;

  // Store actions
  enqueueEvent: (event: MarketSSEEvent) => void;
  pushEvent: (event: MarketSSEEvent) => void;
  ingestEvent: (event: MarketSSEEvent) => void;
  flushBuffer: () => void;
  setScenarios: (scenarios: ScenarioSummary[]) => void;
  setSelectedScenarioId: (scenarioId: string) => void;
  setMode: (mode: RunMode, reason?: string | null) => void;
  setConnectionStatus: (status: ConnectionStatus, usingMock?: boolean) => void;
  clearError: () => void;
  resetRunState: (opts?: { keepScenarioSelection?: boolean }) => void;
  submitShock: (text: string) => Promise<ShockResponse>;
  triggerNewsCheck: () => Promise<NewsCheckResponse>;
  checkLiveNews: () => Promise<NewsCheckResponse>;
}

/* -------------------------------------------------------------------------- */
/* Internal Event Buffer (Flushed Once Per U1 Tick via requestAnimationFrame) */
/* -------------------------------------------------------------------------- */

let eventBuffer: MarketSSEEvent[] = [];
let rafHandle: number | null = null;
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFrame(cb: () => void): number {
  if (
    typeof globalThis.requestAnimationFrame === "function" &&
    typeof globalThis.window !== "undefined"
  ) {
    return globalThis.requestAnimationFrame(() => cb());
  }
  return setTimeout(cb, 16) as unknown as number;
}

function cancelFrame(handle: number | null): void {
  if (handle === null) return;
  if (
    typeof globalThis.cancelAnimationFrame === "function" &&
    typeof globalThis.window !== "undefined"
  ) {
    globalThis.cancelAnimationFrame(handle);
  } else {
    clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
  }
}

function formatDecisionSummaryText(ev: DecisionEventData): string {
  const d = ev.decision as Record<string, unknown>;
  if (ev.role === "ceo_A" || ev.role === "ceo_B") {
    const p = typeof d.price === "number" ? `$${d.price.toFixed(2)}` : "—";
    const q =
      typeof d.production_qty === "number" ? d.production_qty.toFixed(0) : "—";
    const m =
      typeof d.marketing_budget === "number"
        ? `$${d.marketing_budget.toFixed(0)}`
        : "—";
    const exp =
      typeof d.expected_rival_action === "string"
        ? d.expected_rival_action.toUpperCase()
        : "HOLD";
    const rat = typeof d.rationale === "string" ? d.rationale : "";
    return `[Decision: P=${p}, Q=${q}, M=${m}, E[Rival]=${exp}] ${rat}`.trim();
  }
  if (ev.role === "inventory") {
    const omega = typeof d.omega === "number" ? d.omega.toFixed(2) : "0.00";
    const rat = typeof d.rationale === "string" ? d.rationale : "";
    return `[Inventory Buffer ω=${omega}] ${rat}`.trim();
  }
  if (ev.role === "shock_parser") {
    const dc =
      typeof d.delta_c_raw === "number"
        ? `${d.delta_c_raw >= 0 ? "+" : ""}${(d.delta_c_raw * 100).toFixed(0)}%`
        : "0%";
    const dl =
      typeof d.delta_lead_time === "number"
        ? `${d.delta_lead_time >= 0 ? "+" : ""}${d.delta_lead_time}t`
        : "0t";
    const dd =
      typeof d.demand_shock === "number"
        ? `${d.demand_shock >= 0 ? "+" : ""}${(d.demand_shock * 100).toFixed(0)}%`
        : "0%";
    const sev = typeof d.severity === "number" ? d.severity.toFixed(2) : "0.00";
    return `[ShockVector parsed: Δc_raw=${dc}, ΔL=${dl}, ΔD=${dd}, severity=${sev}]`;
  }
  if (ev.role === "crowd") {
    const archs = Array.isArray(d.archetypes) ? d.archetypes.length : 12;
    return `[Crowd Sentiment Updated across ${archs} consumer archetypes]`;
  }
  return JSON.stringify(d);
}

export const useMarketStore = create<MarketStoreState>((set, get) => {
  const flushBuffer = () => {
    if (rafHandle !== null) {
      cancelFrame(rafHandle);
      rafHandle = null;
    }
    if (fallbackTimer !== null) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    if (eventBuffer.length === 0) {
      return;
    }

    const batch = eventBuffer;
    eventBuffer = [];

    set((state) => {
      let scenario = state.scenario;
      let runId = state.runId;
      let selectedScenarioId = state.selectedScenarioId;
      let mode = state.mode;
      let modeReason = state.modeReason;
      let epochTicks = state.epochTicks;
      let tickSeconds = state.tickSeconds;
      let nConsumers = state.nConsumers;
      let currentTick = state.currentTick;
      let currentEpoch = state.currentEpoch;

      const ticksU1 = state.ticksU1.slice();
      const ticksU2 = state.ticksU2.slice();
      const tickSeries = state.tickSeries.slice();
      let latestU1 = state.latestU1;
      let latestU2 = state.latestU2;
      let spilloverTotal: FirmPair<number> = [
        state.spilloverTotal[0],
        state.spilloverTotal[1],
      ];

      const decisions = state.decisions.slice();
      const latestDecisions: Partial<Record<DecisionRole, DecisionEventData>> = {
        ...state.latestDecisions,
      };
      const reasoningGroups: EpochReasoningGroup[] = state.reasoningGroups.map(
        (g) => ({
          ...g,
          entries: g.entries.map((e) => ({ ...e })),
        })
      );
      const activeReasoningRoles: Record<string, boolean> = {
        ...state.activeReasoningRoles,
      };

      let groundings = state.groundings.slice();
      let crowd = state.crowd;
      let archetypes = state.archetypes;
      let nash = state.nash;
      let stats = state.stats;
      const statsHistory = state.statsHistory.slice();
      let telemetry = state.telemetry;
      let lastError = state.lastError;

      const ensureEpochGroup = (epochIdx: number): EpochReasoningGroup => {
        let group = reasoningGroups.find((g) => g.epoch === epochIdx);
        if (!group) {
          const epLen = Math.max(1, epochTicks || 8);
          group = {
            epoch: epochIdx,
            startTick: epochIdx * epLen + 1,
            endTick: (epochIdx + 1) * epLen,
            entries: [],
          };
          reasoningGroups.push(group);
          reasoningGroups.sort((a, b) => a.epoch - b.epoch);
          if (reasoningGroups.length > 30) {
            reasoningGroups.splice(0, reasoningGroups.length - 30);
          }
        }
        return group;
      };

      for (const item of batch) {
        switch (item.event) {
          case "scenario": {
            const sc = item.data;
            scenario = sc;
            runId = sc.run_id;
            selectedScenarioId = sc.scenario_id;
            mode = sc.mode;
            epochTicks = sc.epoch_ticks || 8;
            tickSeconds = sc.tick_seconds || 1.5;
            nConsumers = sc.n_consumers || 200;
            if (choicesRef.current.length !== nConsumers) {
              choicesRef.current = new Int8Array(nConsumers);
              choicesRef.nConsumers = nConsumers;
            }
            break;
          }

          case "tick": {
            const tData = item.data;
            currentTick = Math.max(currentTick, tData.tick);
            currentEpoch = Math.floor(
              Math.max(0, currentTick - 1) / Math.max(1, epochTicks || 8)
            );

            if (tData.universe === "U1") {
              latestU1 = tData;
              spilloverTotal = [
                +(spilloverTotal[0] + (tData.spill_in?.[0] ?? 0)).toFixed(2),
                +(spilloverTotal[1] + (tData.spill_in?.[1] ?? 0)).toFixed(2),
              ];
              const existingU1Idx = ticksU1.findIndex(
                (t) => t.tick === tData.tick
              );
              if (existingU1Idx >= 0) {
                ticksU1[existingU1Idx] = tData;
              } else {
                ticksU1.push(tData);
                if (ticksU1.length > MAX_ROLLING_TICKS) {
                  ticksU1.splice(0, ticksU1.length - MAX_ROLLING_TICKS);
                }
              }

              const existingSeriesIdx = tickSeries.findIndex(
                (p) => p.tick === tData.tick
              );
              const matchingU2 =
                ticksU2.find((u) => u.tick === tData.tick) ?? null;
              if (existingSeriesIdx >= 0) {
                tickSeries[existingSeriesIdx] = {
                  ...tickSeries[existingSeriesIdx],
                  u1: tData,
                  u2: tickSeries[existingSeriesIdx].u2 ?? matchingU2,
                  stats: tickSeries[existingSeriesIdx].stats ?? stats,
                };
              } else {
                tickSeries.push({
                  tick: tData.tick,
                  u1: tData,
                  u2: matchingU2,
                  stats,
                });
                if (tickSeries.length > MAX_ROLLING_TICKS) {
                  tickSeries.splice(0, tickSeries.length - MAX_ROLLING_TICKS);
                }
              }
            } else if (tData.universe === "U2") {
              latestU2 = tData;
              const existingU2Idx = ticksU2.findIndex(
                (t) => t.tick === tData.tick
              );
              if (existingU2Idx >= 0) {
                ticksU2[existingU2Idx] = tData;
              } else {
                ticksU2.push(tData);
                if (ticksU2.length > MAX_ROLLING_TICKS) {
                  ticksU2.splice(0, ticksU2.length - MAX_ROLLING_TICKS);
                }
              }

              const existingSeriesIdx = tickSeries.findIndex(
                (p) => p.tick === tData.tick
              );
              if (existingSeriesIdx >= 0) {
                tickSeries[existingSeriesIdx] = {
                  ...tickSeries[existingSeriesIdx],
                  u2: tData,
                };
              }
            }
            break;
          }

          case "reasoning": {
            const { role, delta, tick: rTick } = item.data;
            const effectiveTick =
              typeof rTick === "number" ? rTick : Math.max(1, currentTick);
            const epIdx = Math.floor(
              Math.max(0, effectiveTick - 1) / Math.max(1, epochTicks || 8)
            );
            const group = ensureEpochGroup(epIdx);
            activeReasoningRoles[role] = true;

            let entry = [...group.entries]
              .reverse()
              .find((e) => e.role === role && !e.done);
            if (!entry) {
              entry = {
                id: `reas-${epIdx}-${role}-${group.entries.length}`,
                epoch: epIdx,
                tick: effectiveTick,
                role,
                tier: roleToTier(role),
                model: roleToDefaultModel(role),
                text: delta,
                done: false,
                updatedAt: Date.now(),
              };
              group.entries.push(entry);
            } else {
              entry.text += delta;
              entry.updatedAt = Date.now();
            }
            break;
          }

          case "reasoning_done": {
            const { role } = item.data;
            activeReasoningRoles[role] = false;
            for (let i = reasoningGroups.length - 1; i >= 0; i--) {
              const group = reasoningGroups[i];
              const entry = [...group.entries]
                .reverse()
                .find((e) => e.role === role && !e.done);
              if (entry) {
                entry.done = true;
                entry.updatedAt = Date.now();
                break;
              }
            }
            break;
          }

          case "decision": {
            const dEv = item.data;
            decisions.push(dEv);
            if (decisions.length > MAX_ROLLING_TICKS * 2) {
              decisions.splice(0, decisions.length - MAX_ROLLING_TICKS * 2);
            }
            latestDecisions[dEv.role] = dEv;

            const epIdx = Math.floor(
              Math.max(0, (dEv.tick || currentTick || 1) - 1) /
                Math.max(1, epochTicks || 8)
            );
            const group = ensureEpochGroup(epIdx);
            const existingEntry = [...group.entries]
              .reverse()
              .find((e) => e.role === dEv.role);

            if (
              existingEntry &&
              (dEv.role === "ceo_A" || dEv.role === "ceo_B")
            ) {
              existingEntry.decision = dEv;
              existingEntry.model = dEv.model || existingEntry.model;
              existingEntry.done = true;
              existingEntry.updatedAt = Date.now();
            } else {
              group.entries.push({
                id: `dec-${epIdx}-${dEv.role}-${dEv.tick}-${group.entries.length}`,
                epoch: epIdx,
                tick: dEv.tick || currentTick,
                role: dEv.role,
                tier: dEv.tier,
                model: dEv.model,
                text: formatDecisionSummaryText(dEv),
                done: true,
                decision: dEv,
                updatedAt: Date.now(),
              });
            }
            break;
          }

          case "crowd": {
            crowd = item.data;
            archetypes = item.data.archetypes;
            break;
          }

          case "grounding": {
            const gCard = item.data;
            const existingIdx = groundings.findIndex((g) => g.id === gCard.id);
            if (existingIdx >= 0) {
              groundings[existingIdx] = gCard;
            } else {
              groundings = [gCard, ...groundings].slice(0, 50);
            }
            break;
          }

          case "nash": {
            nash = item.data;
            break;
          }

          case "stats": {
            stats = item.data;
            const existingStatIdx = statsHistory.findIndex(
              (s) => s.tick === item.data.tick
            );
            if (existingStatIdx >= 0) {
              statsHistory[existingStatIdx] = item.data;
            } else {
              statsHistory.push(item.data);
              if (statsHistory.length > MAX_ROLLING_TICKS) {
                statsHistory.splice(0, statsHistory.length - MAX_ROLLING_TICKS);
              }
            }
            const seriesIdx = tickSeries.findIndex(
              (p) => p.tick === item.data.tick
            );
            if (seriesIdx >= 0) {
              tickSeries[seriesIdx] = {
                ...tickSeries[seriesIdx],
                stats: item.data,
              };
            }
            break;
          }

          case "telemetry": {
            telemetry = item.data;
            break;
          }

          case "mode": {
            mode = item.data.mode;
            modeReason = item.data.reason || null;
            break;
          }

          case "error": {
            lastError = item.data;
            break;
          }
        }
      }

      return {
        scenario,
        runId,
        selectedScenarioId,
        mode,
        modeReason,
        epochTicks,
        tickSeconds,
        nConsumers,
        currentTick,
        currentEpoch,
        ticksU1,
        ticksU2,
        u1Series: ticksU1,
        u2Series: ticksU2,
        tickSeries,
        history: tickSeries,
        latestU1,
        latestU2,
        spilloverTotal,
        decisions,
        latestDecisions,
        reasoningGroups,
        activeReasoningRoles,
        groundings,
        groundingCards: groundings,
        crowd,
        archetypes,
        nash,
        stats,
        statsHistory,
        telemetry,
        lastError,
      };
    });
  };

  const enqueueEvent = (event: MarketSSEEvent) => {
    // Immediately decode choices_b64 into the shared TypedArray ref on U1 ticks
    // so the Canvas Arena never waits on React state or allocates per frame.
    if (
      event.event === "tick" &&
      event.data.universe === "U1" &&
      event.data.choices_b64
    ) {
      choicesRef.current = decodeChoicesB64(
        event.data.choices_b64,
        choicesRef.current
      );
      choicesRef.tick = event.data.tick;
      choicesRef.nConsumers = choicesRef.current.length;
    }

    eventBuffer.push(event);

    // Primary rule: Flush buffered events ONCE per U1 tick via requestAnimationFrame.
    if (event.event === "tick" && event.data.universe === "U1") {
      if (rafHandle === null) {
        rafHandle = scheduleFrame(() => {
          rafHandle = null;
          flushBuffer();
        });
      }
      return;
    }

    // For initial scenario metadata, mode switch, error, or out-of-band news-check grounding
    // when no U1 tick arrives shortly, schedule a low-frequency fallback flush so control UI
    // updates even before tick 1 or after a run stops.
    if (
      event.event === "scenario" ||
      event.event === "mode" ||
      event.event === "error" ||
      (event.event === "grounding" && event.data.live)
    ) {
      if (rafHandle === null) {
        rafHandle = scheduleFrame(() => {
          rafHandle = null;
          flushBuffer();
        });
      }
    } else if (get().currentTick === 0 && fallbackTimer === null) {
      fallbackTimer = setTimeout(() => {
        fallbackTimer = null;
        if (rafHandle === null) {
          rafHandle = scheduleFrame(() => {
            rafHandle = null;
            flushBuffer();
          });
        }
      }, 120);
    }
  };

  const triggerNewsCheckAction = async (): Promise<NewsCheckResponse> => {
    if (actionDelegates.triggerNewsCheck) {
      return actionDelegates.triggerNewsCheck();
    }
    return { accepted: false, reason: "Stream client not initialized." };
  };

  return {
    scenarios: DEFAULT_SCENARIOS,
    selectedScenarioId: DEFAULT_SCENARIOS[0].id,
    scenario: null,
    runId: null,
    mode: "replay",
    modeReason: null,
    connectionStatus: "idle",
    usingMock: false,

    currentTick: 0,
    currentEpoch: 0,
    epochTicks: 8,
    tickSeconds: 1.5,
    nConsumers: 200,

    ticksU1: [],
    ticksU2: [],
    u1Series: [],
    u2Series: [],
    tickSeries: [],
    history: [],
    latestU1: null,
    latestU2: null,
    spilloverTotal: [0, 0],

    choicesRef,

    decisions: [],
    latestDecisions: {},
    reasoningGroups: [],
    activeReasoningRoles: {},

    groundings: [],
    groundingCards: [],
    crowd: null,
    archetypes: [],
    nash: null,
    stats: null,
    statsHistory: [],
    telemetry: createInitialTelemetry(),
    lastError: null,

    enqueueEvent,
    pushEvent: enqueueEvent,
    ingestEvent: enqueueEvent,
    flushBuffer,

    setScenarios: (scenarios) =>
      set((state) => ({
        scenarios: scenarios.length > 0 ? scenarios : DEFAULT_SCENARIOS,
        selectedScenarioId: scenarios.some(
          (s) => s.id === state.selectedScenarioId
        )
          ? state.selectedScenarioId
          : (scenarios[0]?.id ?? DEFAULT_SCENARIOS[0].id),
      })),

    setSelectedScenarioId: (scenarioId) =>
      set({ selectedScenarioId: scenarioId }),

    setMode: (mode, reason = null) =>
      set({ mode, modeReason: reason ?? null }),

    setConnectionStatus: (connectionStatus, usingMock) =>
      set((state) => ({
        connectionStatus,
        usingMock: usingMock !== undefined ? usingMock : state.usingMock,
      })),

    clearError: () => set({ lastError: null }),

    resetRunState: (opts) => {
      eventBuffer = [];
      if (rafHandle !== null) {
        cancelFrame(rafHandle);
        rafHandle = null;
      }
      if (fallbackTimer !== null) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      choicesRef.current.fill(0);
      choicesRef.tick = 0;

      set((state) => ({
        scenario: null,
        runId: null,
        selectedScenarioId: opts?.keepScenarioSelection
          ? state.selectedScenarioId
          : DEFAULT_SCENARIOS[0].id,
        modeReason: null,
        currentTick: 0,
        currentEpoch: 0,
        ticksU1: [],
        ticksU2: [],
        u1Series: [],
        u2Series: [],
        tickSeries: [],
        history: [],
        latestU1: null,
        latestU2: null,
        spilloverTotal: [0, 0],
        decisions: [],
        latestDecisions: {},
        reasoningGroups: [],
        activeReasoningRoles: {},
        groundings: [],
        groundingCards: [],
        crowd: null,
        archetypes: [],
        nash: null,
        stats: null,
        statsHistory: [],
        telemetry: createInitialTelemetry(),
        lastError: null,
      }));
    },

    submitShock: async (text: string): Promise<ShockResponse> => {
      if (actionDelegates.submitShock) {
        return actionDelegates.submitShock(text);
      }
      return { accepted: false, reason: "Stream client not initialized." };
    },

    triggerNewsCheck: triggerNewsCheckAction,
    checkLiveNews: triggerNewsCheckAction,
  };
});

// Convenient aliases for parallel tasks (T11, T12)
export const useStore = useMarketStore;
export const useSimStore = useMarketStore;
export default useMarketStore;

