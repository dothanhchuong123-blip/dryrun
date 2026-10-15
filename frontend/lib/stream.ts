/**
 * Network layer: REST helpers and the two EventSource clients (analysis stream, replay stream).
 *
 * `NEXT_PUBLIC_API_BASE` unset, or the backend unreachable on the first call → everything falls back to
 * the in-browser mock (frontend/mock) and `backendKind()` returns "mock" so the mode chip can say so.
 * Both transports feed the same typed events into the store's `applyAnalysisEvent` / `applyReplayEvent`.
 */
import type {
  AcceptedResponse,
  AddPlanResponse,
  AnalysisEvent,
  AnalysisEventName,
  BusinessProfile,
  CreateAnalysisRequest,
  CreateAnalysisResponse,
  ExamplesResponse,
  MemoEventData,
  NewsCheckResponse,
  ParseProfileResponse,
  PlanSpec,
  ReplayEvent,
  ReplayEventName,
  StartReplayResponse,
  VerifyResponse,
} from "./events";
import { ANALYSIS_EVENT_NAMES, REPLAY_EVENT_NAMES } from "./events";
import type { MockAnalysisHandle } from "../mock";

export type BackendKind = "api" | "mock";

export function getApiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/+$/, "");
}

let kind: BackendKind = getApiBase() ? "api" : "mock";
const kindListeners = new Set<(k: BackendKind) => void>();

export function backendKind(): BackendKind {
  return kind;
}
export function onBackendKind(fn: (k: BackendKind) => void): () => void {
  kindListeners.add(fn);
  return () => kindListeners.delete(fn);
}
function setKind(k: BackendKind) {
  if (k === kind) return;
  kind = k;
  kindListeners.forEach((fn) => fn(k));
}

const mockModule = () => import("../mock");

/** HTTP error with the parsed JSON body (e.g. `{reason}` on 429). */
export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    message: string,
  ) {
    super(message);
  }
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, body, `HTTP ${res.status} ${path}`);
  }
  return (await res.json()) as T;
}

/** True when the failure means "no backend there" (network error, 404/5xx) rather than a real answer. */
function isOffline(e: unknown): boolean {
  return !(e instanceof ApiError) || e.status >= 500 || e.status === 404;
}

let probed: Promise<void> | null = null;
/** One health check; a failure flips the whole session to the mock. */
async function probe(): Promise<void> {
  if (kind === "mock") return;
  probed ??= (async () => {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 3000);
      const res = await fetch(`${getApiBase()}/health`, { signal: ctl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error("unhealthy");
    } catch {
      setKind("mock");
    }
  })();
  await probed;
}

// ---- the mock session (one analysis at a time) -------------------------------------------------

let mockHandle: MockAnalysisHandle | null = null;
let analysisSink: ((ev: AnalysisEvent) => void) | null = null;
let currentAnalysisId: string | null = null;

// ---- REST --------------------------------------------------------------------------------------

export const api = {
  async examples(): Promise<ExamplesResponse> {
    await probe();
    if (kind === "api") {
      try {
        return await http<ExamplesResponse>("/api/examples");
      } catch (e) {
        if (!isOffline(e)) throw e;
        setKind("mock");
      }
    }
    return (await mockModule()).mockExamples();
  },

  async parseProfile(text: string): Promise<ParseProfileResponse> {
    await probe();
    if (kind === "api") {
      try {
        return await http<ParseProfileResponse>("/api/profile/parse", {
          method: "POST",
          body: JSON.stringify({ text }),
        });
      } catch (e) {
        if (!isOffline(e)) throw e;
        setKind("mock");
      }
    }
    return (await mockModule()).mockParseProfile(text);
  },

  async createAnalysis(req: CreateAnalysisRequest): Promise<CreateAnalysisResponse> {
    await probe();
    if (kind === "api") {
      try {
        const r = await http<CreateAnalysisResponse>("/api/analyses", { method: "POST", body: JSON.stringify(req) });
        currentAnalysisId = r.analysis_id;
        return r;
      } catch (e) {
        if (!isOffline(e)) throw e;
        setKind("mock");
      }
    }
    const r = (await mockModule()).mockCreateAnalysis(req);
    currentAnalysisId = r.analysis_id;
    return r;
  },

  async addPlan(id: string, plan: PlanSpec): Promise<AddPlanResponse> {
    if (kind === "mock") return mockHandle?.addPlan(plan) ?? { accepted: false, reason: "No analysis running." };
    return http<AddPlanResponse>(`/api/analyses/${id}/plans`, { method: "POST", body: JSON.stringify({ plan }) });
  },

  async newsCheck(id: string): Promise<NewsCheckResponse> {
    if (kind === "mock") return mockHandle?.newsCheck() ?? { accepted: false, reason: "No analysis running." };
    return http<NewsCheckResponse>(`/api/analyses/${id}/news-check`, { method: "POST" });
  },

  async verify(id: string): Promise<VerifyResponse> {
    if (kind === "mock") return mockHandle?.verify() ?? { accepted: false };
    return http<VerifyResponse>(`/api/analyses/${id}/verify`, { method: "POST" });
  },

  async stop(id: string): Promise<void> {
    if (kind === "mock") {
      mockHandle?.stop();
      return;
    }
    await http(`/api/analyses/${id}/stop`, { method: "POST" }).catch(() => undefined);
  },

  async startReplay(
    id: string,
    planName: string,
    shockId: string,
    spec?: PlanSpec,
  ): Promise<StartReplayResponse> {
    void spec; // only the mock needs the plan's settings, and it gets them in connectReplayStream
    if (kind === "mock") return { replay_id: `mock:${planName}|${shockId}` };
    const r = await http<StartReplayResponse>(`/api/analyses/${id}/replay`, {
      method: "POST",
      body: JSON.stringify({ plan_name: planName, shock_id: shockId }),
    });
    return r;
  },

  /** Markdown download of the memo. */
  async memoMarkdown(id: string, memo: MemoEventData | null): Promise<string> {
    if (kind === "mock" || !memo) {
      if (!memo) throw new Error("No memo yet.");
      return (await mockModule()).memoMarkdown(memo);
    }
    const res = await fetch(`${getApiBase()}/api/analyses/${id}/memo?format=md`);
    if (!res.ok) throw new ApiError(res.status, null, "memo download failed");
    return res.text();
  },
};

export type { AcceptedResponse, BusinessProfile };

// ---- EventSource clients -----------------------------------------------------------------------

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000];

function openEventSource(
  url: string,
  names: readonly string[],
  onEvent: (name: string, data: unknown) => void,
  onGiveUp: (reason: string) => void,
  isFinished: () => boolean,
): () => void {
  let es: EventSource | null = null;
  let closed = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (closed) return;
    es = new EventSource(url);
    for (const name of names) {
      es.addEventListener(name, (e) => {
        attempt = 0;
        try {
          onEvent(name, JSON.parse((e as MessageEvent).data));
        } catch {
          /* ignore malformed event */
        }
      });
    }
    es.onerror = () => {
      es?.close();
      es = null;
      if (closed || isFinished()) return;
      if (attempt >= BACKOFF_MS.length) {
        onGiveUp("Lost the connection to the server.");
        return;
      }
      timer = setTimeout(connect, BACKOFF_MS[attempt++]);
    };
  };
  connect();
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    es?.close();
  };
}

/** Analysis stream client. Returns a close function. */
export function connectAnalysisStream(
  analysisId: string,
  onEvent: (ev: AnalysisEvent) => void,
  onGiveUp: (reason: string) => void,
): () => void {
  if (kind === "mock") {
    analysisSink = onEvent;
    let stopped = false;
    void mockModule().then((m) => {
      if (stopped) return;
      mockHandle?.stop();
      mockHandle = m.runMockAnalysis((ev) => analysisSink?.(ev));
    });
    return () => {
      stopped = true;
      mockHandle?.stop();
      mockHandle = null;
      analysisSink = null;
    };
  }
  let finished = false;
  const close = openEventSource(
    `${getApiBase()}/api/analyses/${analysisId}/events`,
    ANALYSIS_EVENT_NAMES,
    (name, data) => {
      if (name === "done") finished = true;
      onEvent({ event: name as AnalysisEventName, data } as AnalysisEvent);
    },
    onGiveUp,
    () => finished,
  );
  return close;
}

/** Replay stream client. `spec` only matters to the mock, for plans the user added. */
export function connectReplayStream(
  replayId: string,
  onEvent: (ev: ReplayEvent) => void,
  onGiveUp: (reason: string) => void,
  mockArgs?: { planName: string; shockId: string; spec?: PlanSpec },
): () => void {
  if (kind === "mock") {
    let stop: (() => void) | null = null;
    let closed = false;
    void mockModule().then((m) => {
      if (closed || !mockArgs) return;
      stop = m.runMockReplay(mockArgs.planName, mockArgs.shockId, onEvent, mockArgs.spec);
    });
    return () => {
      closed = true;
      stop?.();
    };
  }
  let finished = false;
  return openEventSource(
    `${getApiBase()}/api/replays/${replayId}/events`,
    REPLAY_EVENT_NAMES,
    (name, data) => {
      if (name === "replay_done") finished = true;
      onEvent({ event: name as ReplayEventName, data } as ReplayEvent);
    },
    onGiveUp,
    () => finished,
  );
}

export function getCurrentAnalysisId(): string | null {
  return currentAnalysisId;
}
