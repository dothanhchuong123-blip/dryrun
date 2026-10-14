import {
  BenchmarkExportFormat,
  MarketSSEEvent,
  NewsCheckResponse,
  RunMode,
  ScenarioSummary,
  ShockResponse,
  SSE_EVENT_NAMES,
  SSEEventName,
  StartRunResponse,
} from "./events";
import {
  DEFAULT_SCENARIOS,
  registerStreamActionDelegates,
  useMarketStore,
} from "./store";
import {
  buildLocalBenchmarkExport,
  MockStreamHandle,
  startMockStream,
} from "../mock";

export function getApiBase(): string {
  const raw =
    (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_BASE) || "";
  return raw.replace(/\/+$/, "");
}

export interface StreamClientOptions {
  apiBase?: string;
  maxReconnectAttempts?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  forceMock?: boolean;
}

/**
 * Reconnecting EventSource client using NEXT_PUBLIC_API_BASE.
 * Automatically falls back to the mock/replay stream when NEXT_PUBLIC_API_BASE
 * is not configured or the backend is offline during frontend development.
 */
export class MarketStreamClient {
  private apiBase: string;
  private maxReconnectAttempts: number;
  private initialBackoffMs: number;
  private maxBackoffMs: number;
  private forceMock: boolean;

  private eventSource: EventSource | null = null;
  private mockHandle: MockStreamHandle | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private activeRunId: string | null = null;
  private activeScenarioId: string = DEFAULT_SCENARIOS[0].id;
  private activeMode: RunMode = "replay";
  private closedExplicitly = false;

  constructor(opts?: StreamClientOptions) {
    this.apiBase = (opts?.apiBase ?? getApiBase()).replace(/\/+$/, "");
    this.maxReconnectAttempts = opts?.maxReconnectAttempts ?? 5;
    this.initialBackoffMs = opts?.initialBackoffMs ?? 1000;
    this.maxBackoffMs = opts?.maxBackoffMs ?? 10000;
    this.forceMock =
      opts?.forceMock ??
      (typeof process !== "undefined" &&
        process.env?.NEXT_PUBLIC_USE_MOCK === "1");
  }

  public async fetchScenarios(): Promise<ScenarioSummary[]> {
    if (this.forceMock || !this.apiBase) {
      useMarketStore.getState().setScenarios(DEFAULT_SCENARIOS);
      return DEFAULT_SCENARIOS;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(`${this.apiBase}/api/scenarios`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as ScenarioSummary[];
      if (Array.isArray(data) && data.length > 0) {
        useMarketStore.getState().setScenarios(data);
        return data;
      }
    } catch {
      // Backend unavailable; fall back to built-in scenarios
    }
    useMarketStore.getState().setScenarios(DEFAULT_SCENARIOS);
    return DEFAULT_SCENARIOS;
  }

  public async startRun(
    scenarioId: string,
    mode: RunMode
  ): Promise<{ runId: string; mode: RunMode; usingMock: boolean }> {
    this.stop();
    this.closedExplicitly = false;
    this.reconnectAttempts = 0;
    this.activeScenarioId = scenarioId;
    this.activeMode = mode;

    const store = useMarketStore.getState();
    store.resetRunState({ keepScenarioSelection: true });
    store.setSelectedScenarioId(scenarioId);
    store.setMode(mode, null);

    if (this.forceMock || !this.apiBase) {
      return this.startFallbackMock(scenarioId, mode);
    }

    store.setConnectionStatus("connecting", false);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(`${this.apiBase}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario_id: scenarioId, mode }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        throw new Error(`POST /api/runs returned ${res.status}`);
      }

      const payload = (await res.json()) as StartRunResponse;
      this.activeRunId = payload.run_id;
      this.activeMode = payload.mode;

      if (payload.mode !== mode) {
        store.setMode(
          payload.mode,
          "Mode downgraded to REPLAY by daily spend guard."
        );
      }

      this.openEventSource(payload.run_id);
      return {
        runId: payload.run_id,
        mode: payload.mode,
        usingMock: false,
      };
    } catch {
      // Seamlessly switch to mock/replay stream when backend is unreachable
      return this.startFallbackMock(scenarioId, mode);
    }
  }

  private startFallbackMock(
    scenarioId: string,
    mode: RunMode
  ): { runId: string; mode: RunMode; usingMock: boolean } {
    const store = useMarketStore.getState();
    const mockRunId = `mock-${scenarioId}-${Date.now().toString(36)}`;
    this.activeRunId = mockRunId;
    store.setConnectionStatus("mock", true);

    this.mockHandle = startMockStream(scenarioId, mode, (ev: MarketSSEEvent) => {
      useMarketStore.getState().enqueueEvent(ev);
    });

    return {
      runId: mockRunId,
      mode,
      usingMock: true,
    };
  }

  private openEventSource(runId: string): void {
    if (this.closedExplicitly || typeof EventSource === "undefined") {
      return;
    }

    this.closeEventSourceOnly();
    const url = `${this.apiBase}/api/runs/${encodeURIComponent(runId)}/events`;
    const es = new EventSource(url);
    this.eventSource = es;

    es.onopen = () => {
      this.reconnectAttempts = 0;
      useMarketStore.getState().setConnectionStatus("connected", false);
    };

    const bindEvent = (eventName: SSEEventName) => {
      es.addEventListener(eventName, (evt: MessageEvent) => {
        try {
          const parsedData = JSON.parse(evt.data);
          useMarketStore.getState().enqueueEvent({
            event: eventName,
            data: parsedData,
          } as MarketSSEEvent);
        } catch {
          // Ignore malformed JSON frames
        }
      });
    };

    for (const name of SSE_EVENT_NAMES) {
      bindEvent(name);
    }

    es.onerror = () => {
      if (this.closedExplicitly) return;
      this.closeEventSourceOnly();

      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        const delay = Math.min(
          this.maxBackoffMs,
          this.initialBackoffMs * Math.pow(2, this.reconnectAttempts)
        );
        this.reconnectAttempts += 1;
        useMarketStore.getState().setConnectionStatus("reconnecting", false);

        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          if (!this.closedExplicitly && this.activeRunId) {
            this.openEventSource(this.activeRunId);
          }
        }, delay);
      } else {
        // After max reconnect attempts, transition smoothly to mock stream
        this.startFallbackMock(this.activeScenarioId, this.activeMode);
      }
    };
  }

  private closeEventSourceOnly(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.eventSource !== null) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  public stop(): void {
    this.closedExplicitly = true;
    this.closeEventSourceOnly();
    if (this.mockHandle !== null) {
      this.mockHandle.stop();
      this.mockHandle = null;
    }
    const runId = this.activeRunId;
    this.activeRunId = null;

    if (runId && this.apiBase && !runId.startsWith("mock-")) {
      void fetch(`${this.apiBase}/api/runs/${encodeURIComponent(runId)}/stop`, {
        method: "POST",
      }).catch(() => {});
    }
  }

  public async submitShock(text: string): Promise<ShockResponse> {
    if (this.mockHandle) {
      return this.mockHandle.injectShock(text);
    }
    const runId = this.activeRunId ?? useMarketStore.getState().runId;
    if (!runId || !this.apiBase) {
      return { accepted: false, reason: "No active run." };
    }
    try {
      const res = await fetch(
        `${this.apiBase}/api/runs/${encodeURIComponent(runId)}/shock`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        }
      );
      if (!res.ok) {
        return { accepted: false, reason: `HTTP ${res.status}` };
      }
      return (await res.json()) as ShockResponse;
    } catch {
      return { accepted: false, reason: "Failed to reach shock endpoint." };
    }
  }

  public async triggerNewsCheck(): Promise<NewsCheckResponse> {
    if (this.mockHandle) {
      return this.mockHandle.triggerNewsCheck();
    }
    const runId = this.activeRunId ?? useMarketStore.getState().runId;
    if (!runId || !this.apiBase) {
      return { accepted: false, reason: "No active run." };
    }
    try {
      const res = await fetch(
        `${this.apiBase}/api/runs/${encodeURIComponent(runId)}/news-check`,
        {
          method: "POST",
        }
      );
      if (!res.ok) {
        return { accepted: false, reason: `HTTP ${res.status}` };
      }
      return (await res.json()) as NewsCheckResponse;
    } catch {
      return { accepted: false, reason: "Failed to reach news-check endpoint." };
    }
  }

  public async exportBenchmark(format: BenchmarkExportFormat): Promise<void> {
    if (this.apiBase && !this.mockHandle) {
      try {
        const res = await fetch(
          `${this.apiBase}/api/benchmark/export?format=${encodeURIComponent(
            format
          )}`
        );
        if (res.ok) {
          const blob = await res.blob();
          this.triggerBrowserDownload(
            blob,
            `market-digital-twin-benchmark.${format}`
          );
          return;
        }
      } catch {
        // Fall through to local benchmark generation
      }
    }

    const { content, mime, filename } = buildLocalBenchmarkExport(format);
    if (typeof Blob !== "undefined") {
      const blob = new Blob([content], { type: mime });
      this.triggerBrowserDownload(blob, filename);
    }
  }

  private triggerBrowserDownload(blob: Blob, filename: string): void {
    if (typeof document === "undefined" || typeof URL === "undefined") return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

let sharedClient: MarketStreamClient | null = null;

export function getStreamClient(): MarketStreamClient {
  if (!sharedClient) {
    sharedClient = new MarketStreamClient();
    registerStreamActionDelegates({
      submitShock: (text) => sharedClient!.submitShock(text),
      triggerNewsCheck: () => sharedClient!.triggerNewsCheck(),
    });
  }
  return sharedClient;
}

export async function connectRunStream(
  scenarioId: string,
  mode: RunMode
): Promise<{ runId: string; mode: RunMode; usingMock: boolean }> {
  return getStreamClient().startRun(scenarioId, mode);
}

export function disconnectRunStream(): void {
  getStreamClient().stop();
}

export async function submitShock(text: string): Promise<ShockResponse> {
  return getStreamClient().submitShock(text);
}

export async function triggerNewsCheck(): Promise<NewsCheckResponse> {
  return getStreamClient().triggerNewsCheck();
}

export async function exportBenchmark(
  format: BenchmarkExportFormat = "md"
): Promise<void> {
  return getStreamClient().exportBenchmark(format);
}

