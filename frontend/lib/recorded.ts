/**
 * Offline player for the real-case recordings (task B1): `public/replays/*.jsonl`, copied from
 * `fixtures/replays/` by next.config.mjs. Used only when there is no backend (the in-browser mock);
 * with a backend the same recordings stream over SSE.
 *
 * A recording is one JSON object per line: `{t, event, data}`, `t` in seconds since the start.
 */
import type { BacktestsResponse } from "./events";

interface Recorded {
  t: number;
  event: string;
  data: unknown;
}

const BASE = "/replays";

async function fetchText(path: string): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/${path}`);
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/** The cases to show on screen 1 (written by next.config.mjs from fixtures/backtests). */
export async function recordedBacktests(): Promise<BacktestsResponse> {
  const text = await fetchText("backtests.json");
  if (!text) return [];
  try {
    return JSON.parse(text) as BacktestsResponse;
  } catch {
    return [];
  }
}

/** The file name of a case's recorded pick on the real path, or null when it has none. */
export async function recordedRealizedCell(backtestId: string): Promise<string | null> {
  const text = await fetchText("manifest.json");
  if (!text) return null;
  try {
    const names = (JSON.parse(text) as { replays: string[] }).replays;
    return names.find((n) => n.startsWith(`cell_backtest_${backtestId}_`) && n.endsWith("_realized")) ?? null;
  } catch {
    return null;
  }
}

/**
 * Plays a recording through `emit`, at the pace it was recorded. `onFail` runs if it cannot be read.
 * Returns a stop function.
 */
export function playRecording(
  name: string,
  emit: (event: string, data: unknown) => void,
  onFail: (reason: string) => void,
): () => void {
  let live = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  void fetchText(`${name}.jsonl`).then((text) => {
    if (!live) return;
    if (!text) {
      onFail("That recording is not available offline.");
      return;
    }
    const events: Recorded[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as Recorded);
      } catch {
        /* skip a damaged line */
      }
    }
    const t0 = performance.now();
    let i = 0;
    const pump = () => {
      timer = null;
      if (!live) return;
      const now = (performance.now() - t0) / 1000;
      while (i < events.length && events[i].t <= now + 0.005) {
        emit(events[i].event, events[i].data);
        i++;
      }
      if (i < events.length) timer = setTimeout(pump, Math.max(0, (events[i].t - now) * 1000));
    };
    pump();
  });
  return () => {
    live = false;
    if (timer) clearTimeout(timer);
  };
}
