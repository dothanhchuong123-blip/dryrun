"use client";

/**
 * Zustand store for the "Test your plans" app. This file is the contract for F1–F3: screens read these
 * fields and call these actions; they never talk to the network directly.
 *
 * Event flow: stream.ts (real SSE or the mock) → `applyAnalysisEvent` / `applyReplayEvent` → state.
 * Update rules:
 *  - Replay ticks: at most ONE store update per week (U1 and U2 are paired before the update).
 *  - Reasoning text is accumulated in a module-level buffer and flushed to the store ~8×/s.
 *  - The arena reads shopper choices from `choicesRef`, never from React state.
 */
import { create } from "zustand";
import type {
  AgentStepData,
  AnalysisEvent,
  BacktestEventData,
  BacktestSummary,
  BusinessProfile,
  CrowdArchetype,
  ErrorEventData,
  ExampleSummary,
  GridCellData,
  GridSummaryData,
  MarkerData,
  MemoEventData,
  NewsItem,
  SearchReport,
  PlanEventData,
  PlanSource,
  PlanSpec,
  ReplayEvent,
  RunMode,
  ProfileSource,
  ScenariosEventData,
  ShockCase,
  TelemetryData,
  TickEventData,
} from "./events";
import { decodeChoicesB64 } from "./events";
import type { InputRejection } from "./events";
import { splitLink } from "./link";
import {
  ApiError,
  api,
  backendKind,
  connectAnalysisStream,
  connectReplayStream,
  getCurrentAnalysisId,
  onBackendKind,
  type BackendKind,
} from "./stream";

export type Step = "business" | "news" | "analyst" | "memo";
export const STEPS: { id: Step; label: string }[] = [
  { id: "business", label: "Your business" },
  { id: "news", label: "News" },
  { id: "analyst", label: "Analyst + plans" },
  { id: "memo", label: "Memo" },
];

export type ProfileStatus = "idle" | "reading" | "ready" | "error";
export type AnalysisStatus = "idle" | "starting" | "running" | "done" | "error";

export interface AnalysisInfo {
  id: string | null;
  mode: RunMode | null;
  status: AnalysisStatus;
  exampleId: string | null;
  /** (B1) a real case: the date the run pretends it is, and which case */
  asOf: string | null;
  backtestId: string | null;
  costUsd: number | null;
  /** reason from a `mode` event or an error, for the mode chip tooltip / error banner */
  note: string | null;
  /** F6: the run stopped because the models can't be reached (an `error` event with recoverable: true) */
  modelsDown: boolean;
}

export interface PlanRow {
  name: string;
  source: PlanSource;
  round: number;
  spec: PlanSpec;
}

export interface AgentStepRow extends AgentStepData {
  /** arrival order, a stable React key */
  seq: number;
}

export type ReplayStatus = "idle" | "loading" | "streaming" | "done" | "error";
export interface ReplayState {
  open: boolean;
  planName: string | null;
  shockId: string | null;
  shockLabel: string | null;
  status: ReplayStatus;
  weeks: number;
  nConsumers: number;
  weekSeconds: number;
  playing: boolean;
  /** 0-based index of the week on screen; the tick for it is u1[week] / u2[week] */
  week: number;
  u1: TickEventData[];
  u2: TickEventData[];
  markers: MarkerData[];
  cumProfit: { U1: number; U2: number } | null;
  error: string | null;
}

/** Shopper choices of the week on screen, for the arena. Mutated in place, never read as React state. */
export const choicesRef: { current: Int8Array } = { current: new Int8Array(0) };

export const cellKey = (plan: string, shock: string) => `${plan}|${shock}`;
export const reasoningKey = (role: string, round: number) => `${role}:${round}`;
export const MAX_USER_PLANS = 4;

/** editing any mix dial clears the one "customer_mix" guess flag */
const MIX_KEYS: Set<string> = new Set(["income_mix", "price_hunter_share", "loyal_share"]);

const emptyReplay = (): ReplayState => ({
  open: false,
  planName: null,
  shockId: null,
  shockLabel: null,
  status: "idle",
  weeks: 24,
  nConsumers: 0,
  weekSeconds: 0.9,
  playing: false,
  week: 0,
  u1: [],
  u2: [],
  markers: [],
  cumProfit: null,
  error: null,
});

const emptyAnalysis = (): AnalysisInfo => ({
  id: null,
  mode: null,
  status: "idle",
  exampleId: null,
  asOf: null,
  backtestId: null,
  costUsd: null,
  note: null,
  modelsDown: false,
});

interface RunData {
  analysis: AnalysisInfo;
  news: NewsItem[];
  /** (v2.6) the Tavily search log of the analysis's own news step */
  searched: SearchReport | null;
  usedForGrid: string | null;
  shocks: ShockCase[];
  scenarios: ScenariosEventData | null;
  plans: PlanRow[];
  crowdByPlan: Record<string, CrowdArchetype[]>;
  cells: Record<string, GridCellData>;
  summary: GridSummaryData | null;
  agentSteps: AgentStepRow[];
  reasoningByRound: Record<string, string>;
  reasoningDone: Record<string, boolean>;
  memo: MemoEventData | null;
  /** (B1) the advice scored against what really happened */
  backtest: BacktestEventData | null;
  telemetry: TelemetryData | null;
  replay: ReplayState;
}

const emptyRun = (): RunData => ({
  analysis: emptyAnalysis(),
  news: [],
  searched: null,
  usedForGrid: null,
  shocks: [],
  scenarios: null,
  plans: [],
  crowdByPlan: {},
  cells: {},
  summary: null,
  agentSteps: [],
  reasoningByRound: {},
  reasoningDone: {},
  memo: null,
  backtest: null,
  telemetry: null,
  replay: emptyReplay(),
});

export interface MarketState extends RunData {
  step: Step;
  backend: BackendKind;

  examples: ExampleSummary[];
  /** (B1) the real cases under the examples */
  backtests: BacktestSummary[];
  /** the free-text box on screen 1 */
  profileText: string;
  /** set by pickExample; cleared when the text or any field is edited */
  exampleId: string | null;
  profile: BusinessProfile | null;
  profileStatus: ProfileStatus;
  profileFallback: boolean;
  profileError: string | null;
  /** set when the profile was read from a pasted link */
  profileSource: ProfileSource | null;
  /** F5: the file in the box (one at a time) and the gate's "not enough / not a business" answer */
  profileFile: File | null;
  profileReject: InputRejection | null;

  // actions
  setProfileFile(file: File | null): void;
  loadExamples(): Promise<void>;
  setProfileText(text: string): void;
  parseProfile(text: string): Promise<void>;
  setProfileField<K extends keyof BusinessProfile>(key: K, value: BusinessProfile[K]): void;
  pickExample(id: string): void;
  /** (B1) Plays a real case: the run starts at once, because the case brings its own business. */
  pickBacktest(id: string): Promise<void>;
  startAnalysis(): Promise<void>;
  /** Plays a recorded example (no model call): the one picked (`id`), or after F6 stopped a live run, the run's
   * example or the first one with a recording. */
  watchRecorded(id?: string): Promise<boolean>;
  /** Adds a user plan row (engine only, free). Resolves to an error message, or null when accepted. */
  addPlan(spec: PlanSpec): Promise<string | null>;
  newsCheck(): Promise<string | null>;
  verify(): Promise<void>;
  openReplay(planName: string, shockId: string): Promise<void>;
  closeReplay(): void;
  playReplay(): void;
  pauseReplay(): void;
  toggleReplay(): void;
  stepReplay(delta: number): void;
  seekReplay(week: number): void;
  setStep(step: Step): void;
  downloadMemo(): Promise<void>;
  /** Back to screen 1 with everything cleared ("Try another business"). */
  reset(): void;

  // event reducers (called by stream.ts)
  applyAnalysisEvent(ev: AnalysisEvent): void;
  applyReplayEvent(ev: ReplayEvent): void;
}

// ---- module-level plumbing (not React state) ---------------------------------------------------

let closeAnalysisStream: (() => void) | null = null;
let closeReplayStream: (() => void) | null = null;
let clock: ReturnType<typeof setInterval> | null = null;
let pendingU1: TickEventData | null = null;
let reasoningBuf: Record<string, string> = {};
let reasoningTimer: ReturnType<typeof setTimeout> | null = null;
let stepSeq = 0;

function stopClock() {
  if (clock) clearInterval(clock);
  clock = null;
}

function syncChoices(r: ReplayState) {
  const tick = r.u1[r.week];
  if (tick?.choices_b64) choicesRef.current = decodeChoicesB64(tick.choices_b64, choicesRef.current);
}

/** Can the user go to this step yet? Used by the step bar. */
export function canGoTo(s: Pick<MarketState, "profile" | "analysis" | "shocks" | "memo" | "news">, step: Step): boolean {
  switch (step) {
    case "business":
      return true;
    case "news":
      return s.analysis.status !== "idle";
    case "analyst":
      return s.shocks.length > 0 || s.news.length > 0;
    case "memo":
      return s.memo !== null;
  }
}

export function downloadText(filename: string, text: string, type = "text/markdown") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- the store ---------------------------------------------------------------------------------

export const useMarketStore = create<MarketState>()((set, get) => {
  const fail = (message: string) =>
    set((s) => ({ analysis: { ...s.analysis, status: "error", note: message } }));

  const startClock = () => {
    stopClock();
    clock = setInterval(() => {
      const r = get().replay;
      if (!r.playing) return stopClock();
      const next = r.week + 1;
      if (next < r.u1.length) {
        const updated = { ...r, week: next };
        syncChoices(updated);
        set({ replay: updated });
      } else if (r.status === "done" || r.u1.length >= r.weeks) {
        set({ replay: { ...r, playing: false } });
        stopClock();
      } // else: wait for the next week to arrive
    }, Math.max(150, get().replay.weekSeconds * 1000));
  };

  return {
    ...emptyRun(),
    step: "business",
    backend: backendKind(),
    examples: [],
    backtests: [],
    profileText: "",
    exampleId: null,
    profile: null,
    profileStatus: "idle",
    profileFallback: false,
    profileError: null,
    profileSource: null,
    profileFile: null,
    profileReject: null,

    setProfileFile(file) {
      set({ profileFile: file, profileReject: null, profileError: null, exampleId: null });
    },

    async loadExamples() {
      if (get().examples.length) return;
      try {
        set({ examples: await api.examples(), backend: backendKind() });
      } catch {
        set({ examples: [] });
      }
      try {
        set({ backtests: (await api.backtests()).filter((b) => b.has_replay) });
      } catch {
        set({ backtests: [] });
      }
    },

    setProfileText(text) {
      set({ profileText: text, exampleId: null });
    },

    async parseProfile(text) {
      const trimmed = text.trim();
      const file = get().profileFile;
      if (!trimmed && !file) return;
      const keepExample = get().exampleId && get().examples.find((e) => e.id === get().exampleId)?.text.trim() === trimmed;
      set({
        profileText: text,
        profileStatus: "reading",
        profileError: null,
        profileSource: null,
        profileReject: null,
        exampleId: keepExample ? get().exampleId : null,
      });
      try {
        const { url, note } = splitLink(trimmed);
        const res = file ? await api.parseProfileFile(file, trimmed) : await api.parseProfile(note, url);
        set({
          profile: res.profile,
          profileFallback: res.fallback_used,
          profileSource: res.source ?? null,
          profileStatus: "ready",
          backend: backendKind(),
        });
      } catch (e) {
        const body = e instanceof ApiError ? (e.body as Partial<InputRejection> | null) : null;
        if (e instanceof ApiError && e.status === 422 && (body?.code === "too_little" || body?.code === "not_business")) {
          // not an error: the box stays as it is and Flow shows what to add
          set({
            profileStatus: "idle",
            profileReject: { code: body.code, reason: String(body.reason ?? ""), missing: body.missing ?? [] },
          });
          return;
        }
        const reason = e instanceof ApiError ? (e.body as { reason?: unknown } | null)?.reason : null;
        const msg =
          typeof reason === "string" && e instanceof ApiError && [0, 422, 429, 502].includes(e.status)
            ? reason
            : e instanceof ApiError && e.status === 429
              ? "You've read a few businesses already. Try again in a while, or pick an example."
              : "Could not read that. Try again, or pick an example.";
        set({ profileStatus: "error", profileError: msg });
      }
    },

    setProfileField(key, value) {
      const p = get().profile;
      if (!p) return;
      set({
        profile: { ...p, [key]: value, guessed_fields: p.guessed_fields.filter((f) => f !== key && !(MIX_KEYS.has(key) && f === "customer_mix")) },
        exampleId: null,
      });
    },

    pickExample(id) {
      const ex = get().examples.find((e) => e.id === id);
      if (!ex) return;
      set({
        exampleId: id,
        profileText: ex.text,
        profile: null,
        profileStatus: "idle",
        profileError: null,
        profileSource: null,
        profileFile: null,
        profileReject: null,
      });
    },

    async pickBacktest(id) {
      if (!get().backtests.some((b) => b.id === id)) return;
      closeAnalysisStream?.();
      closeAnalysisStream = null;
      get().closeReplay();
      stopClock();
      reasoningBuf = {};
      stepSeq = 0;
      const asOf = get().backtests.find((b) => b.id === id)?.as_of ?? null;
      set({
        ...emptyRun(),
        analysis: { ...emptyAnalysis(), status: "starting", mode: "replay", backtestId: id, asOf },
        step: "news",
        exampleId: null,
        profile: null,
        profileText: "",
        profileStatus: "reading",
        profileError: null,
        profileSource: null,
        profileFile: null,
        profileReject: null,
      });
      try {
        const res = await api.createAnalysis({ backtest_id: id, mode: "replay" });
        set((s) => ({ analysis: { ...s.analysis, id: res.analysis_id, mode: "replay", status: "running" }, backend: backendKind() }));
        closeAnalysisStream = connectAnalysisStream(
          res.analysis_id,
          (ev) => get().applyAnalysisEvent(ev),
          (reason) => fail(reason),
        );
      } catch (e) {
        const reason =
          e instanceof ApiError && e.status === 409
            ? "That case has no recording yet."
            : "Could not start that case.";
        fail(reason);
        set({ step: "business", profileStatus: "error", profileError: reason });
      }
    },

    async startAnalysis() {
      const { profile, exampleId } = get();
      if (!profile) return;
      closeAnalysisStream?.();
      closeAnalysisStream = null;
      get().closeReplay();
      stopClock();
      reasoningBuf = {};
      stepSeq = 0;
      const mode: RunMode = exampleId ? "replay" : "live";
      set({ ...emptyRun(), analysis: { ...emptyAnalysis(), status: "starting", exampleId, mode }, step: "news" });
      try {
        const res = await api.createAnalysis(exampleId ? { example_id: exampleId, mode } : { profile, mode: "live" });
        set((s) => ({ analysis: { ...s.analysis, id: res.analysis_id, mode: res.mode, status: "running" }, backend: backendKind() }));
        closeAnalysisStream = connectAnalysisStream(
          res.analysis_id,
          (ev) => get().applyAnalysisEvent(ev),
          (reason) => fail(reason),
        );
      } catch (e) {
        const reason =
          e instanceof ApiError && e.status === 429
            ? ((e.body as { reason?: string } | null)?.reason ?? "Live runs are paused for now. Try an example instead.")
            : "Could not start the analysis.";
        fail(reason);
        set({ step: "business" });
      }
    },

    async watchRecorded(id) {
      const s = get();
      const ex = id
        ? s.examples.find((e) => e.has_replay && e.id === id)
        : (s.examples.find((e) => e.has_replay && e.id === s.analysis.exampleId) ?? s.examples.find((e) => e.has_replay));
      if (!ex) return false;
      closeAnalysisStream?.();
      closeAnalysisStream = null;
      get().closeReplay();
      stopClock();
      reasoningBuf = {};
      stepSeq = 0;
      set({
        ...emptyRun(),
        analysis: { ...emptyAnalysis(), status: "starting", exampleId: ex.id, mode: "replay" },
        step: "news",
        exampleId: ex.id,
        profileText: ex.text,
        profile: null,
        profileStatus: "ready", // the recording brings its own profile, so no model has to read the text
        profileError: null,
        profileSource: null,
        profileFile: null,
        profileReject: null,
      });
      try {
        const res = await api.createAnalysis({ example_id: ex.id, mode: "replay" });
        set((st) => ({ analysis: { ...st.analysis, id: res.analysis_id, mode: "replay", status: "running" }, backend: backendKind() }));
        closeAnalysisStream = connectAnalysisStream(res.analysis_id, (ev) => get().applyAnalysisEvent(ev), (reason) => fail(reason));
        return true;
      } catch {
        fail("Could not start the recorded run.");
        return false;
      }
    },

    async addPlan(spec) {
      const s = get();
      const id = s.analysis.id ?? getCurrentAnalysisId();
      if (!id) return "Start an analysis first.";
      if (s.plans.filter((p) => p.source === "user").length >= MAX_USER_PLANS)
        return `You can add up to ${MAX_USER_PLANS} plans.`;
      if (s.plans.some((p) => p.name === spec.name)) return "A plan with that name already exists.";
      try {
        const res = await api.addPlan(id, spec);
        return res.accepted ? null : (res.reason ?? "The plan was not accepted.");
      } catch {
        return "Could not add that plan.";
      }
    },

    async newsCheck() {
      const id = get().analysis.id;
      if (!id) return "Start an analysis first.";
      try {
        const res = await api.newsCheck(id);
        return res.accepted ? null : (res.reason ?? "Live news is busy. Try again in a minute.");
      } catch (e) {
        return e instanceof ApiError && e.status === 429
          ? "Live news is limited to one check a minute."
          : "Could not check live news.";
      }
    },

    async verify() {
      const id = get().analysis.id;
      if (!id) return;
      try {
        await api.verify(id);
      } catch {
        set((s) => ({
          telemetry: s.telemetry ? { ...s.telemetry, job: { id: null, status: "failed" } } : s.telemetry,
        }));
      }
    },

    async openReplay(planName, shockId) {
      const s = get();
      const id = s.analysis.id;
      if (!id) return;
      closeReplayStream?.();
      closeReplayStream = null;
      stopClock();
      pendingU1 = null;
      choicesRef.current = new Int8Array(0);
      const shock = s.shocks.find((x) => x.id === shockId);
      set({
        replay: { ...emptyReplay(), open: true, planName, shockId, shockLabel: shock?.label ?? null, status: "loading" },
      });
      const spec = s.plans.find((p) => p.name === planName)?.spec;
      try {
        const res = await api.startReplay(id, planName, shockId, spec);
        closeReplayStream = connectReplayStream(
          res.replay_id,
          (ev) => get().applyReplayEvent(ev),
          (reason) => set((st) => ({ replay: { ...st.replay, status: "error", error: reason, playing: false } })),
          { planName, shockId, spec },
        );
      } catch {
        set((st) => ({ replay: { ...st.replay, status: "error", error: "Could not start the replay." } }));
      }
    },

    closeReplay() {
      closeReplayStream?.();
      closeReplayStream = null;
      stopClock();
      pendingU1 = null;
      set((s) => (s.replay.open || s.replay.status !== "idle" ? { replay: emptyReplay() } : {}));
    },

    playReplay() {
      const r = get().replay;
      if (!r.open || r.status === "loading" || r.status === "error") return;
      // at the end: start over
      const from = r.week >= r.weeks - 1 && r.status === "done" ? 0 : r.week;
      const next = { ...r, playing: true, week: from };
      syncChoices(next);
      set({ replay: next });
      startClock();
    },
    pauseReplay() {
      stopClock();
      set((s) => ({ replay: { ...s.replay, playing: false } }));
    },
    toggleReplay() {
      if (get().replay.playing) get().pauseReplay();
      else get().playReplay();
    },
    stepReplay(delta) {
      const r = get().replay;
      if (!r.open || r.u1.length === 0) return;
      stopClock();
      const week = Math.min(Math.max(r.week + delta, 0), r.u1.length - 1);
      const next = { ...r, playing: false, week };
      syncChoices(next);
      set({ replay: next });
    },
    seekReplay(week) {
      const r = get().replay;
      if (!r.open || r.u1.length === 0) return;
      const next = { ...r, week: Math.min(Math.max(Math.round(week), 0), r.u1.length - 1) };
      syncChoices(next);
      set({ replay: next });
    },

    setStep(step) {
      if (!canGoTo(get(), step)) return;
      get().closeReplay();
      set({ step });
    },

    async downloadMemo() {
      const { memo, analysis } = get();
      if (!memo) return;
      try {
        const text = await api.memoMarkdown(analysis.id ?? "", memo);
        downloadText("decision-memo.md", text);
      } catch {
        /* nothing to download */
      }
    },

    reset() {
      closeAnalysisStream?.();
      closeAnalysisStream = null;
      closeReplayStream?.();
      closeReplayStream = null;
      stopClock();
      reasoningBuf = {};
      set({
        ...emptyRun(),
        step: "business",
        profileText: "",
        exampleId: null,
        profile: null,
        profileStatus: "idle",
        profileError: null,
        profileSource: null,
        profileFile: null,
        profileReject: null,
      });
    },

    // ---- reducers --------------------------------------------------------------------------------

    applyAnalysisEvent(ev) {
      switch (ev.event) {
        case "analysis":
          set((s) => ({
            analysis: {
              ...s.analysis,
              id: ev.data.analysis_id || s.analysis.id,
              // the recording was made LIVE; a real case is always played back
              mode: ev.data.backtest_id ? "replay" : ev.data.mode,
              exampleId: ev.data.example_id,
              asOf: ev.data.as_of ?? s.analysis.asOf,
              backtestId: ev.data.backtest_id ?? s.analysis.backtestId,
              status: "running",
            },
            profile: s.profile ?? ev.data.profile,
            // a real case brings its own business, so there is nothing to read
            profileStatus: ev.data.backtest_id ? "ready" : s.profileStatus,
          }));
          break;
        case "mode":
          set((s) => ({ analysis: { ...s.analysis, mode: s.analysis.backtestId ? "replay" : ev.data.mode, note: ev.data.reason } }));
          break;
        case "news":
          set((s) => {
            const live = ev.data.items.length > 0 && ev.data.items.every((i) => i.live && !i.applied);
            const items = live
              ? [...s.news, ...ev.data.items.filter((i) => !s.news.some((n) => n.id === i.id))]
              : ev.data.items;
            return {
              news: items,
              searched: live ? s.searched : (ev.data.searched ?? null),
              usedForGrid: live ? s.usedForGrid : ev.data.used_for_grid,
            };
          });
          break;
        case "scenarios":
          set({ scenarios: ev.data });
          break;
        case "shocks":
          set({ shocks: ev.data.cases });
          break;
        case "plan":
          set((s) => upsertPlan(s.plans, ev.data));
          break;
        case "crowd":
          set((s) => ({ crowdByPlan: { ...s.crowdByPlan, [ev.data.plan_name]: ev.data.archetypes } }));
          break;
        case "grid_cell":
          set((s) => {
            const key = cellKey(ev.data.plan_name, ev.data.shock_id);
            const old = s.cells[key];
            // cloud results replace local ones; a late local cell never replaces a cloud one
            if (old?.source === "cloud" && ev.data.source === "local") return {};
            return { cells: { ...s.cells, [key]: ev.data } };
          });
          break;
        case "grid_summary":
          set({ summary: ev.data });
          break;
        case "agent_step":
          set((s) => ({ agentSteps: [...s.agentSteps, { ...ev.data, seq: stepSeq++ }] }));
          break;
        case "reasoning": {
          const k = reasoningKey(ev.data.role, ev.data.round);
          reasoningBuf[k] = (reasoningBuf[k] ?? "") + ev.data.delta;
          if (!reasoningTimer) {
            reasoningTimer = setTimeout(() => {
              reasoningTimer = null;
              set({ reasoningByRound: { ...reasoningBuf } });
            }, 120);
          }
          break;
        }
        case "reasoning_done":
          set((s) => ({
            reasoningByRound: { ...reasoningBuf },
            reasoningDone: { ...s.reasoningDone, [reasoningKey(ev.data.role, ev.data.round)]: true },
          }));
          break;
        case "memo":
          set({ memo: ev.data });
          break;
        case "backtest":
          set({ backtest: ev.data });
          break;
        case "telemetry":
          set({ telemetry: ev.data });
          break;
        case "error":
          handleError(ev.data);
          break;
        case "done":
          // a run that stopped on an error stays an error: `done` only closes the stream
          set((s) => ({
            analysis: { ...s.analysis, status: s.analysis.modelsDown ? "error" : "done", costUsd: ev.data.cost_usd },
          }));
          break;
      }
    },

    applyReplayEvent(ev) {
      switch (ev.event) {
        case "replay_start":
          set((s) => ({
            replay: {
              ...s.replay,
              status: "streaming",
              weeks: ev.data.weeks,
              nConsumers: ev.data.n_consumers,
              weekSeconds: ev.data.week_seconds,
              shockLabel: ev.data.shock_label || s.replay.shockLabel,
            },
          }));
          break;
        case "marker":
          set((s) => ({ replay: { ...s.replay, markers: [...s.replay.markers, ev.data] } }));
          break;
        case "tick": {
          // pair U1 and U2 so there is one store update per week
          if (ev.data.universe === "U1") {
            pendingU1 = ev.data;
            break;
          }
          const u1 = pendingU1;
          pendingU1 = null;
          if (!u1) break;
          const first = get().replay.u1.length === 0;
          set((s) => ({ replay: { ...s.replay, u1: [...s.replay.u1, u1], u2: [...s.replay.u2, ev.data] } }));
          if (first) {
            syncChoices(get().replay);
            get().playReplay();
          }
          break;
        }
        case "replay_done":
          set((s) => ({ replay: { ...s.replay, status: "done", cumProfit: ev.data.cum_profit_usd } }));
          break;
      }
    },
  };

  function handleError(e: ErrorEventData) {
    if (e.recoverable) set((s) => ({ analysis: { ...s.analysis, status: "error", note: e.message, modelsDown: true } }));
    else fail(e.message);
  }
});

function upsertPlan(plans: PlanRow[], p: PlanEventData): { plans: PlanRow[] } {
  const row: PlanRow = { name: p.name, source: p.source, round: p.round, spec: p.spec };
  const i = plans.findIndex((x) => x.name === p.name);
  if (i === -1) return { plans: [...plans, row] };
  const next = plans.slice();
  next[i] = row;
  return { plans: next };
}

// keep `backend` in sync when stream.ts flips to the mock
if (typeof window !== "undefined") {
  onBackendKind((k) => useMarketStore.setState({ backend: k }));
}

// handy in the browser console while building screens: window.__store.getState()
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __store: typeof useMarketStore }).__store = useMarketStore;
}
