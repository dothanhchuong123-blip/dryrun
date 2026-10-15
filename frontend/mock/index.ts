/**
 * Offline mock backend for the v2 contract (docs/EVENTS.md v2.1), for the coffee_hcmc example.
 *
 * All numbers come from the real planner via `scripts/make_mock_stream.py`
 * (coffee_hcmc.json, coffee_hcmc_replays.json). Only the wording (headlines, agent text, crowd mood)
 * is scripted here. Re-run the script after any engine change.
 *
 * The mock emits the same typed events the SSE client would, so the store cannot tell the difference.
 */
import type {
  AcceptedResponse,
  AgentStepData,
  AnalysisEvent,
  BusinessProfile,
  CellBridge,
  CreateAnalysisRequest,
  CreateAnalysisResponse,
  CrowdArchetype,
  ExamplesResponse,
  GridCellData,
  GridSummaryData,
  MarkerData,
  MemoEventData,
  NewsItem,
  ParseProfileResponse,
  PlanSpec,
  ReplayEvent,
  ShockCase,
  TelemetryData,
  TickEventData,
} from "../lib/events";
import { labels } from "../lib/labels";
import { formatDelta, formatMoney } from "../lib/format";
import data from "./coffee_hcmc.json";

// ---- typed view of the generated JSON ----------------------------------------------------------

interface PlanRow {
  name: string;
  source: "seed" | "ai" | "user";
  round: number;
  spec: PlanSpec;
}
interface LibEntry {
  extra_stock_weeks: number;
  price_change_pct: number;
  cells: Omit<GridCellData, "plan_name">[];
}
interface RecordedReplay {
  plan_name: string;
  shock_id: string;
  shock_label: string;
  weeks: { U1: TickEventData; U2: TickEventData }[];
  markers: MarkerData[];
  cum_profit_usd: { U1: number; U2: number };
}
interface MockData {
  examples: (ExamplesResponse[number] & { profile: BusinessProfile })[];
  profile: BusinessProfile;
  news: NewsItem[];
  shocks: ShockCase[];
  plans: PlanRow[];
  crowd: { plan_name: string; archetypes: CrowdArchetype[] }[];
  cells: GridCellData[];
  baseline_profit_usd: Record<string, number>;
  baseline_no_change_usd: number;
  best_today: string;
  safest: string;
  memo: { plan_name: string; numbers: MemoEventData["numbers"]; cost_line: string | null };
  library: LibEntry[];
  n_shoppers: number;
}
const D = data as unknown as MockData;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---- REST mocks --------------------------------------------------------------------------------

export function mockExamples(): ExamplesResponse {
  return D.examples.map(({ profile: _profile, ...rest }) => rest);
}

/** Returns the matching example's profile after 1.5 s; anything else gets the coffee profile. */
export async function mockParseProfile(text: string): Promise<ParseProfileResponse> {
  await sleep(1500);
  const hit = D.examples.find((e) => e.text.trim() === text.trim());
  return { profile: structuredClone(hit?.profile ?? D.profile), fallback_used: false };
}

export function mockCreateAnalysis(_req: CreateAnalysisRequest): CreateAnalysisResponse {
  return { analysis_id: `mock-${Date.now().toString(36)}`, mode: "replay" };
}

// ---- helpers -----------------------------------------------------------------------------------

const cellKey = (p: string, s: string) => `${p}|${s}`;
const cellMap = new Map(D.cells.map((c) => [cellKey(c.plan_name, c.shock_id), c]));
const planNames = D.plans.map((p) => p.name);
const shockById = new Map(D.shocks.map((s) => [s.id, s]));

function sumBridge(b: CellBridge): number {
  return b.cost_usd + b.price_usd + b.volume_usd + b.marketing_usd + b.holding_usd;
}
const r2 = (x: number) => Math.round(x * 100) / 100;

/** What "Do nothing" earns in a column, e.g. for the headline. */
const baseline = D.baseline_profit_usd;

// ---- the scripted analysis ---------------------------------------------------------------------

type Timed = { t: number; ev: AnalysisEvent };

function step(
  round: number,
  kind: AgentStepData["kind"],
  text: string,
  tier: AgentStepData["tier"],
  plan: string | null = null,
  latency: number | null = null,
): AnalysisEvent {
  return { event: "agent_step", data: { round, kind, text, plan_name: plan, tier, latency_ms: latency } };
}

const SCENARIO_THOUGHT =
  "Beans +31% is the news column. Two bigger worries for a small roaster: the dry spell could push beans to +45% " +
  "with slower shipping, and Highland has said it will protect its cafés, so a 5% price cut is realistic. " +
  "A new chain with 40 outlets could pull 8% of cafés. One column for a bean price fall, marked unlikely.";

const SCENARIO_REASONING = [
  "news n1: robusta +31% in 4 wk. your beans = 85% of cost → cost +26%\n",
  "6.50 × 0.85 × 0.31 = $1.71 a bag. margin 11.00 − 6.50 = $4.50 → 4.50 − 1.71 = $2.79\n",
  "n2: dry spell, harvest −10% → could extend the spike. try +45%, shipping +2 wk\n",
  "m2: Highland 'will not pass it all on' → rival price −5% is plausible\n",
  "m1: 40-outlet chain, own roasting → share shift ~8% of cafés from wk 4\n",
  "also one downside column: beans −12%, unlikely but plans must not rely on a spike\n",
];

const UNMODELLED = [
  { text: "A new tax on imported coffee equipment is being discussed", source_id: "m2" },
  { text: "Your larger cafés may ask for credit terms when prices rise", source_id: null },
];

function roundReasoning(round: number): string[] {
  if (round === 1)
    return [
      "seed results: stock 4 wk covers the spike but is tied to cash ($7.3k of $8,000)\n",
      "price +4% alone: little cash, good in news column, loses in 'beans −12%'\n",
      "try: stock 3 wk + raise 3% wk 3 → less cash, keeps the volume\n",
      "try: stock 6 wk → big gain but cash > $8,000 → will show 'Over your cash'\n",
    ];
  return [
    "best so far: stock 3 wk + raise 3% wk 3. more stock helps while cash allows\n",
    "stock 4 wk fits the $8,000 (peak cash $7.3k) → combine with +3% wk 3\n",
    "marketing +20% costs money now and brings little back → test it once\n",
  ];
}

function cellEvent(plan: string, shock: string): AnalysisEvent {
  const c = cellMap.get(cellKey(plan, shock));
  if (!c) throw new Error(`mock: no cell ${plan}|${shock}`);
  return { event: "grid_cell", data: c };
}

function bestIn(round: number): { best: string; safest: string } {
  const names = D.plans.filter((p) => p.round <= round).map((p) => p.name);
  const cells = D.cells.filter((c) => names.includes(c.plan_name));
  const l = labels(cells, D.shocks, D.profile.cash_available);
  return { best: l.bestToday, safest: l.safest };
}

function summaryEvent(round: number, verified = false): AnalysisEvent {
  const { best, safest } = bestIn(round);
  const data: GridSummaryData = { baseline_profit_usd: baseline, best_today: best, safest, verified };
  return { event: "grid_summary", data };
}

function newsCardText(plan: string): string {
  const c = cellMap.get(cellKey(plan, "news"))!;
  return `${plan}: ${formatDelta(c.mean_delta_usd)} in today's news case, bad case ${formatDelta(c.p5_delta_usd)}.`;
}

function buildMemo(verified = false, cells: Map<string, GridCellData> = cellMap): MemoEventData {
  const plan = D.memo.plan_name;
  const c = cells.get(cellKey(plan, "news"))!;
  const s2 = cells.get(cellKey(plan, "s2"))!;
  const s4 = cells.get(cellKey(plan, "s4"))!;
  const bridge = c.bridge;
  return {
    plan_name: plan,
    headline: "Stock up 4 weeks now and raise your price 3% in week 3",
    why:
      `If beans keep their ${"+31%"} jump, this plan earns ${formatDelta(c.mean_delta_usd)} more than doing nothing. ` +
      `Cheaper stock is worth ${formatDelta(bridge.cost_usd)} and the small rise adds ${formatDelta(bridge.price_usd)}, ` +
      `less ${formatMoney(-bridge.volume_usd)} from customers who leave.`,
    watch_out:
      `It ties up about ${formatMoney(c.peak_cash_usd)} of your $8,000 and only loses if beans fall back (` +
      `${formatDelta(s4.mean_delta_usd)}). If Highland cuts 5% it still earns ${formatDelta(s2.mean_delta_usd)}.`,
    recheck_when: "Beans move more than 10% either way, or Highland changes its price.",
    numbers: {
      ...D.memo.numbers,
      mean_delta_usd: c.mean_delta_usd,
      p5_delta_usd: c.p5_delta_usd,
      p_better: c.p_better,
      n: c.n,
      bridge,
      steady_rival_delta_usd: c.steady_rival_delta_usd,
      peak_cash_usd: c.peak_cash_usd,
      payback_week: c.payback_week,
      over_cash: c.over_cash,
      verified,
    },
    cost_line: D.memo.cost_line,
    sources: [
      { title: D.news[0].title, url: D.news[0].url, quote: D.news[0].quote },
      { title: D.news[1].title, url: D.news[1].url, quote: D.news[1].quote },
    ],
    not_modelled: {
      fixed: [
        "Fixed costs such as rent and salaries (profit here is gross profit)",
        "Taxes",
        "Payment terms: we assume you pay suppliers when you order and customers pay when they buy",
        "Seasonality",
        "Your other products",
        "Warehouse space limits",
        "How other rivals react (we model one main rival)",
      ],
      found: UNMODELLED,
    },
    fallback_used: false,
  };
}

/** Counts per tier at a point of the script; telemetry is computed from these, never typed in. */
interface Calls {
  ultra: number;
  super: number;
  fast: number;
}
function telemetry(calls: Calls, job: TelemetryData["job"]): AnalysisEvent {
  const total = calls.ultra + calls.super + calls.fast || 1;
  const perCall = {
    ultra: { in: 3200, out: 1900, price: 0.0000028 },
    super: { in: 900, out: 260, price: 0.0000006 },
    fast: { in: 420, out: 90, price: 0.0000001 },
  };
  const tiers = {} as TelemetryData["tiers"];
  const tokens = { ultra: 0, super: 0, fast: 0 };
  let cost = 0;
  let allUltra = 0;
  (["ultra", "super", "fast"] as const).forEach((k) => {
    const n = calls[k];
    const t = perCall[k];
    tokens[k] = n * (t.in + t.out);
    cost += tokens[k] * t.price;
    allUltra += tokens[k] * perCall.ultra.price;
    tiers[k] = {
      calls: n,
      tokens_in: n * t.in,
      tokens_out: n * t.out,
      p50_ttft_ms: k === "ultra" ? 2100 : k === "super" ? 480 : 160,
      tok_per_s: k === "ultra" ? 48 : k === "super" ? 120 : 310,
      errors: 0,
    };
  });
  const tokTotal = tokens.ultra + tokens.super + tokens.fast || 1;
  const share = (k: "ultra" | "super" | "fast") => ({
    call: calls[k] / total,
    token: tokens[k] / tokTotal,
  });
  const data: TelemetryData = {
    tiers,
    call_share: { ultra: share("ultra").call, super: share("super").call, fast: share("fast").call },
    token_share: { ultra: share("ultra").token, super: share("super").token, fast: share("fast").token },
    cost_usd: r2(cost * 1000) / 1000,
    cost_all_ultra_usd: r2(allUltra * 1000) / 1000,
    savings_pct: allUltra > 0 ? Math.round((1 - cost / allUltra) * 1000) / 10 : 0,
    job,
  };
  return { event: "telemetry", data };
}

/** The whole ~25 s script as a list of timed events. */
export function buildAnalysisScript(): Timed[] {
  const out: Timed[] = [];
  const calls: Calls = { ultra: 0, super: 0, fast: 0 };
  const idle = { id: null, status: "idle" as const };
  let t = 0;
  const at = (dt: number, ev: AnalysisEvent) => {
    t += dt;
    out.push({ t, ev });
  };
  const tele = (dt = 0.05) => at(dt, telemetry(calls, idle));

  at(0.1, {
    event: "analysis",
    data: {
      analysis_id: "mock",
      mode: "replay",
      example_id: "coffee_hcmc",
      profile: D.profile,
      horizon_weeks: 24,
      n_paths: 1000,
    },
  });
  at(0.2, { event: "mode", data: { mode: "replay", reason: "Offline demo: the recorded coffee example is playing." } });
  calls.super += 1;
  tele(0.3);

  // news
  at(0.7, { event: "news", data: { items: D.news, used_for_grid: "n1" } });
  calls.super += 1;
  tele();

  // 0b futures
  at(0.8, step(0, "think", "Futures to test: reading the news and your market to pick the futures to run.", "ultra", null, 2100));
  for (const chunk of SCENARIO_REASONING) at(0.25, { event: "reasoning", data: { role: "scenarios", round: 0, delta: chunk } });
  at(0.2, { event: "reasoning_done", data: { role: "scenarios", round: 0 } });
  calls.ultra += 1;
  at(0.3, {
    event: "scenarios",
    data: { thought: SCENARIO_THOUGHT, unmodelled: UNMODELLED, fallback_used: false },
  });
  at(0.1, { event: "shocks", data: { cases: D.shocks } });
  tele();

  // rounds: 0 = seed plans, 1 and 2 = Ultra's
  const rounds: { round: number; think: string; test: string; shoppers: string; resultFor: string[] }[] = [
    {
      round: 0,
      think: "Starting with three simple plans: buy more stock, raise the price, or switch supplier.",
      test: `Testing 3 starter plans against ${D.shocks.length} futures, 1,000 runs per cell.`,
      shoppers: "Asked the shopper groups how each starter plan feels to them.",
      resultFor: ["Stock up 4 weeks", "Raise price 4% from week 2"],
    },
    {
      round: 1,
      think: "Stock helps but cash is tight. Trying a smaller stock-up with a price rise, and a bigger one.",
      test: "Testing 2 new plans against all futures.",
      shoppers: "Shoppers: price-hunting cafés dislike a rise more than loyal regulars.",
      resultFor: ["Stock 3 wk + raise 3% wk 3", "Stock up 6 weeks"],
    },
    {
      round: 2,
      think: "Combining what worked: 4 weeks of stock fits your cash, plus a small rise. One marketing test.",
      test: "Testing the last 2 plans.",
      shoppers: "Shoppers: a small rise after a stock-up reads as fair when everyone's costs jump.",
      resultFor: ["Stock 4 wk + raise 3% wk 3"],
    },
  ];

  for (const r of rounds) {
    const roundPlans = D.plans.filter((p) => p.round === r.round);
    at(0.7, step(r.round, "think", r.think, "ultra", null, 2400));
    if (r.round > 0) {
      for (const chunk of roundReasoning(r.round)) at(0.2, { event: "reasoning", data: { role: "analyst", round: r.round, delta: chunk } });
      at(0.1, { event: "reasoning_done", data: { role: "analyst", round: r.round } });
    }
    calls.ultra += 1;
    for (const p of roundPlans) {
      at(0.35, { event: "plan", data: { name: p.name, source: p.source, round: p.round, spec: p.spec } });
    }
    tele();
    at(0.5, step(r.round, "test", r.test, "engine", null, 180));
    for (const p of roundPlans) {
      for (const s of D.shocks) at(0.16, cellEvent(p.name, s.id));
    }
    at(0.4, step(r.round, "shoppers", r.shoppers, "fast", null, 170));
    for (const p of roundPlans) {
      const crowd = D.crowd.find((c) => c.plan_name === p.name)!;
      at(0.15, { event: "crowd", data: crowd });
      calls.fast += 1;
    }
    tele();
    at(0.3, step(r.round, "result", newsCardText(r.resultFor[0]), "engine", r.resultFor[0]));
    at(0.1, summaryEvent(r.round));
  }

  // the over-cash plan is called out in the last result
  at(0.5, step(2, "result", `Stock up 6 weeks looks best on paper (${formatDelta(cellMap.get(cellKey("Stock up 6 weeks", "news"))!.mean_delta_usd)}) but needs ${formatMoney(cellMap.get(cellKey("Stock up 6 weeks", "news"))!.peak_cash_usd)} of cash, more than you have.`, "engine", "Stock up 6 weeks"));
  const best = D.best_today;
  at(0.5, step(2, "finish", `Recommending ${best}: ${newsCardText(best).split(": ")[1]}`, "ultra", best, 1900));
  calls.ultra += 1;
  calls.super += 1;
  tele();
  at(0.5, { event: "memo", data: buildMemo() });
  tele();
  at(0.4, { event: "done", data: { analysis_id: "mock", cost_usd: 0 } });
  return out;
}

export interface MockAnalysisHandle {
  stop(): void;
  addPlan(spec: PlanSpec): AcceptedResponse;
  newsCheck(): AcceptedResponse;
  verify(): { accepted: boolean; job_id?: string };
}

/** Stretch the script so that it lasts about 25 s. */
const SCRIPT_SECONDS = 25;

export function runMockAnalysis(emit: (ev: AnalysisEvent) => void): MockAnalysisHandle {
  const script = buildAnalysisScript();
  const scale = SCRIPT_SECONDS / script[script.length - 1].t;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let userPlans = 0;
  let live = true;
  const later = (ms: number, fn: () => void) => {
    const h = setTimeout(() => {
      timers.delete(h);
      if (live) fn();
    }, ms);
    timers.add(h);
  };
  const calls: Calls = { ultra: 5, super: 4, fast: 8 };

  const known = new Map(cellMap);

  for (const { t, ev } of script) later(t * scale * 1000, () => emit(ev));

  return {
    stop() {
      live = false;
      timers.forEach(clearTimeout);
      timers.clear();
    },

    addPlan(spec) {
      if (userPlans >= 4) return { accepted: false, reason: "You can add up to 4 plans." };
      userPlans += 1;
      const entry = nearestLibrary(spec);
      const name = spec.name || `Your plan ${userPlans}`;
      const full: PlanSpec = { ...spec, name };
      later(120, () => emit({ event: "plan", data: { name, source: "user", round: 3, spec: full } }));
      D.shocks.forEach((s, i) => {
        const base = entry.cells[i];
        const cell: GridCellData = { ...base, plan_name: name, shock_id: s.id, source: "local" };
        known.set(cellKey(name, s.id), cell);
        later(350 + i * 220, () => emit({ event: "grid_cell", data: cell }));
      });
      later(350 + D.shocks.length * 220 + 100, () => {
        const names = new Set([...planNames, ...[...known.keys()].map((k) => k.split("|")[0])]);
        const cells = [...known.values()].filter((c) => names.has(c.plan_name));
        const l = labels(cells, D.shocks, D.profile.cash_available);
        emit({
          event: "grid_summary",
          data: { baseline_profit_usd: baseline, best_today: l.bestToday, safest: l.safest, verified: false },
        });
      });
      return { accepted: true };
    },

    newsCheck() {
      const item: NewsItem = {
        id: `n${Date.now() % 1000}`,
        kind: "supply",
        title: "Vietnamese exporters report robusta stocks at a three-year low",
        url: "https://example.com/news/live-robusta-stocks",
        source: "Nikkei Asia",
        published: "2026-10-15",
        quote: "exporters' robusta stocks are the lowest in three years heading into the new crop",
        shock: { delta_c_raw: 0.12, delta_lead_time: 0, demand_shock: 0 },
        cost_line: "Beans +12% × 85% of your cost is beans = your cost +10% (+$0.66 a bag)",
        impact_usd: null,
        impact_p5_usd: null,
        live: true,
        applied: false,
      };
      later(900, () => emit({ event: "news", data: { items: [item], used_for_grid: null } }));
      return { accepted: true };
    },

    verify() {
      const job = (status: TelemetryData["job"]["status"]) =>
        telemetry(calls, { id: "mock-job", status });
      later(200, () => emit(job("queued")));
      later(1500, () => emit(job("running")));
      // cloud cells: same engine, 10,000 runs: the numbers move a little and the lines still add up
      let i = 0;
      const verified = new Map<string, GridCellData>();
      for (const c of cellMap.values()) {
        const wiggle = 1 + (((i * 37) % 11) - 5) / 400;
        i += 1;
        const bridge: CellBridge = {
          cost_usd: r2(c.bridge.cost_usd * wiggle),
          price_usd: c.bridge.price_usd,
          volume_usd: r2(c.bridge.volume_usd * (2 - wiggle)),
          marketing_usd: c.bridge.marketing_usd,
          holding_usd: c.bridge.holding_usd,
        };
        const cell: GridCellData = { ...c, n: 10000, source: "cloud", bridge, mean_delta_usd: r2(sumBridge(bridge)) };
        verified.set(cellKey(c.plan_name, c.shock_id), cell);
        later(2600 + i * 70, () => emit({ event: "grid_cell", data: cell }));
      }
      const end = 2600 + i * 70 + 200;
      later(end, () => {
        const l = labels([...verified.values()], D.shocks, D.profile.cash_available);
        emit({
          event: "grid_summary",
          data: { baseline_profit_usd: baseline, best_today: l.bestToday, safest: l.safest, verified: true },
        });
        emit({ event: "memo", data: buildMemo(true, verified) });
        emit(job("verified"));
      });
      return { accepted: true, job_id: "mock-job" };
    },
  };
}

/** The recorded library plan closest to the user's stock and price sliders. */
function nearestLibrary(spec: PlanSpec): LibEntry {
  const stock = spec.switch_supplier ? 0 : spec.extra_stock_weeks;
  let best = D.library[0];
  let bestD = Infinity;
  for (const e of D.library) {
    const d = Math.abs(e.extra_stock_weeks - stock) * 2 + Math.abs(e.price_change_pct - spec.price_change_pct);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

// ---- replay ------------------------------------------------------------------------------------

type ReplayFile = Record<string, RecordedReplay>;
let replayFile: Promise<ReplayFile> | null = null;
function loadReplays(): Promise<ReplayFile> {
  replayFile ??= import("./coffee_hcmc_replays.json").then((m) => (m.default ?? m) as unknown as ReplayFile);
  return replayFile;
}

/** Streams one recorded cell (the nearest recorded plan for user-added ones) in about a second. */
export function runMockReplay(
  planName: string,
  shockId: string,
  emit: (ev: ReplayEvent) => void,
  spec?: PlanSpec,
): () => void {
  let live = true;
  const timers: ReturnType<typeof setTimeout>[] = [];
  void loadReplays().then((file) => {
    if (!live) return;
    let rec = file[cellKey(planName, shockId)];
    if (!rec) {
      // a user plan: use the recorded plan with the closest stock and price settings
      const guess = spec ?? { extra_stock_weeks: 0, price_change_pct: 0 };
      let bestD = Infinity;
      for (const p of D.plans) {
        const d =
          Math.abs(p.spec.extra_stock_weeks - (guess.extra_stock_weeks ?? 0)) * 2 +
          Math.abs(p.spec.price_change_pct - (guess.price_change_pct ?? 0));
        if (d < bestD && file[cellKey(p.name, shockId)]) {
          bestD = d;
          rec = file[cellKey(p.name, shockId)];
        }
      }
    }
    const label = shockById.get(shockId)?.label ?? rec.shock_label;
    const at = (ms: number, ev: ReplayEvent) => timers.push(setTimeout(() => live && emit(ev), ms));
    at(0, {
      event: "replay_start",
      data: {
        replay_id: "mock-replay",
        plan_name: planName,
        shock_id: shockId,
        shock_label: label,
        weeks: rec.weeks.length,
        n_consumers: D.n_shoppers,
        week_seconds: 0.9,
      },
    });
    rec.markers.forEach((m) => at(10, { event: "marker", data: m }));
    rec.weeks.forEach((w, i) => {
      at(30 + i * 25, { event: "tick", data: w.U1 });
      at(31 + i * 25, { event: "tick", data: w.U2 });
    });
    at(40 + rec.weeks.length * 25, {
      event: "replay_done",
      data: { replay_id: "mock-replay", cum_profit_usd: rec.cum_profit_usd },
    });
  });
  return () => {
    live = false;
    timers.forEach(clearTimeout);
  };
}

/** Markdown for "Download .md" when offline. */
export function memoMarkdown(m: MemoEventData): string {
  const n = m.numbers;
  const b = n.bridge;
  const line = (label: string, v: number) => `- ${label}: ${formatDelta(v)}`;
  return [
    `# ${m.headline}`,
    "",
    `**Plan:** ${m.plan_name}`,
    "",
    `- Average gain vs doing nothing: ${formatDelta(n.mean_delta_usd)}`,
    `- Bad case (1 run in 20): ${formatDelta(n.p5_delta_usd)}`,
    `- Runs: ${n.n.toLocaleString("en-US")}${n.verified ? " (Nebius-verified)" : ""}`,
    "",
    "## Where the money comes from",
    line("Cheaper stock", b.cost_usd),
    line("Your price change", b.price_usd),
    line("Customers won/lost", b.volume_usd),
    line("Marketing", b.marketing_usd),
    line("Storage & money tied up", b.holding_usd),
    `- Total: ${formatDelta(n.mean_delta_usd)}`,
    "",
    "## Why",
    m.why,
    "",
    "## Watch out for",
    m.watch_out,
    "",
    "## Recheck when",
    m.recheck_when,
    "",
    "## Sources",
    ...m.sources.map((s) => `- [${s.title}](${s.url}): "${s.quote}"`),
    "",
    "## Not in these numbers",
    ...m.not_modelled.fixed.map((f) => `- ${f}`),
    ...m.not_modelled.found.map((f) => `- ${f.text}`),
    "",
  ].join("\n");
}
