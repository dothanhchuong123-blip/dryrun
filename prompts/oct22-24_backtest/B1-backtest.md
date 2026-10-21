# B1: Backtest: "Would Dry Run have helped?" on 4 real shocks

Read `CLAUDE.md` and `SPEC.md` §15 first, and follow the guardrails in CLAUDE.md (especially the rules about keys and `.env`, and the $1 ask rule).

**Model:** Claude Sonnet 5.5, split over two sessions run one after the other:
- **B1a**, Parts A–C (backend, data, recordings), effort high.
- **B1b**, Part D (frontend), effort medium. Start it after B1a is committed, and build it against B1a's recorded `backtest_*.jsonl`.

If you're asked to do only one part, don't touch the other. **Needs:** F5 (done). **Contract changes:** listed in "Contract changes" below. **The user approved all four on 2026-10-21**, so apply them as written.

## Why
Judges and owners both ask: "Is this a toy?" Right now we can only show what Dry Run *says*. This task shows what it *would have said* on a real date in the past, using only news from before that date, and then scores that advice against the real prices that followed. The engine does the scoring, so the result is a fair, checkable number even when the advice turns out wrong. **Ship the result whatever it is.** A memo that lost money is still a useful finding.

Research behind the case choice (2026-10-21):
- **How owners actually responded.** Price rises were the most common response to the 2025 tariffs. Supplier switches and order delays came next.
- **Shocks often reversed.** Cocoa dropped back from its peak. The China tariff fell from 145% to 30%. Egg prices fell after March.
- **Surcharges were a common move.** Waffle House charged 50¢ per egg from Feb 3 and dropped it in the summer.

The engine can't yet express a surcharge that ends, or a cost that rises and falls back. This task adds both.

## Contract changes (APPROVED by the user 2026-10-21)
None of these touch `backend/engine/types.py`.

1. **SPEC §15.4 `PlanSpec`.** Add `price_end_week`: int, 1–24, default **24** (meaning the price change stays to the end of the horizon).
   - The price change applies when `price_change_week ≤ t < price_end_week`.
   - If `price_end_week ≤ price_change_week`, treat it as 24.
   - Add the field in `planner.PlanSpec` (with clamp) and in `schemas.PlanSpecModel` (so Ultra can propose surcharges).
   - Add it in `frontend/lib/events.ts` `PlanSpec` and in the EVENTS.md PlanSpec example.
   - Recordings without the field read as 24, so their behaviour is unchanged.
2. **SPEC §15.5 `ShockCase`.** Add `cost_path`: list[float], default `[]`, length ≤ 24, each value in −0.9…3.0. It is the news input's price change vs week 0, one value per week.
   - **Non-empty:** it replaces `delta_c_raw × ramp` in the cost formula, with **no per-path `scale`** (the path really happened). The last value holds for any later week.
   - **Empty:** behaviour is unchanged.
   - Add a new `origin` value, `"realized"`.
   - `ScenarioCaseModel` (Ultra's schema) does **not** get `cost_path`. Only backtest code builds it.
3. **EVENTS.md (v2.2).**
   - `analysis` gains `as_of: "YYYY-MM-DD"|null` and `backtest_id|null`.
   - New REST `GET /api/backtests` → `[{id, title, subtitle, as_of, has_replay}]`.
   - `POST /api/analyses` accepts `{backtest_id}`. It is REPLAY only and plays `fixtures/replays/backtest_<id>.jsonl`.
   - New stream event `backtest`, sent after `memo` and before `done` (shape in Part C).
   - `/api/analyses/{id}/replay` accepts `shock_id: "realized"` when the analysis is a backtest.
4. **SPEC.** Add new §15.12 "Backtest", summarising this file, and a P0 row in §15.10.

## What already exists (don't rebuild it)
- **Grid runner.** `planner.run_grid` / `_simulate` in `backend/engine/planner.py`. The cost line is at `spot_a` / `spot_b` (`_cost_factor(exposed, dc * scale, lvl)`). Your price is at `p_a = np.where(t >= price_week, …)`. Markers are built in `_markers` (around line 1080).
- **Analysis flow.** `Analysis` in `backend/sim/analysis.py`: news → scenarios (0b) → analyst rounds → memo. The CLI in `backend/sim/cli.py` has `--example` and `--record`.
- **News search.** `NewsWatch.find` in `backend/services/news_watch.py` uses `time_range="week"`/`"month"`. `TavilyScout.search` in `backend/services/tavily_scout.py` caches by request dict.
- **Prompts.** In `backend/agents/prompts.py`. **No prompt states today's date**: Ultra assumes "now".
- **Seed plans.** "Do nothing", "Raise price 5% now", "Stock up 4 weeks now", plus the optional "Textbook price rule". These are the backtest's baselines.

## Day-0 checks (first, under $0.05 and ~10 Tavily credits)
1. **Tavily date window.** One `topic="news"`, `search_depth="basic"` search with `start_date`/`end_date` (YYYY-MM-DD, added July 2025, see docs.tavily.com/changelog). Example: "cocoa price" with end_date 2024-01-15. Record:
   - Does `end_date` work with `topic="news"`?
   - Does every result carry `published_date`?
   - Do any results fall after `end_date`?
   - Add a `docs/FEEDBACK_LOG.md` row either way.
2. **Model knowledge cutoff.** Find the stated training-data cutoff for `MODEL_ULTRA` and `MODEL_SUPER` (NVIDIA model cards). Then make one Ultra call with thinking OFF and max_tokens 200: "What was the world cocoa price in April 2024? If you don't know, say so."
   - Record what it knows. This is the leakage risk that the memo must disclose.
   - Add a FEEDBACK_LOG row.
3. **Price data.**
   - Download the **World Bank Pink Sheet** monthly file: `CMO-Historical-Data-Monthly.xlsx` from thedocs.worldbank.org, sheet "Monthly Prices", columns Cocoa / Coffee Robusta / Coffee Arabica in $/kg, CC BY 4.0.
   - Download the **BLS** series `APU0000708111`: US city average, eggs grade A large, $/dozen. Use the public API v1 (`POST https://api.bls.gov/publicAPI/v1/timeseries/data/`); no key needed.
   - FRED was down on 2026-10-21. Don't depend on it.
   - Save what you use as `fixtures/prices/<series>.csv` with a header comment: source URL, licence, retrieval date.
   - Don't commit the xlsx.
   - Use `openpyxl` via `uv run --with openpyxl` in a script under `scripts/`. Don't add it to the app's dependencies.

## A. Engine (pure, unit-tested)
- **`price_end_week`.** Make the change in `_simulate`, the `PlanSpec` clamp, and `first_change_week` (unchanged: the start is still the first change).
  - Add a marker at the end week: kind `price_change`, text like "Surcharge ends, price back to $X".
  - In `backend/agents/wording.py` and wherever a plan is described in words, add "until week N" when the end week is below 24.
- **`cost_path`.** In `_simulate`, when `shock.cost_path` is set, use `dc_t = path[min(t, len-1)]` in both `spot_b` and `spot_a`, with no `scale` and no ramp. The alternative supplier still gets `alt_shock_exposure`.
  - `pre_shock` for the old-cost share means `dc_t == 0`.
  - `cost_change()` and `wording.cost_line` use the **path's end value** and also mention the peak ("+121% at the peak in April, +75% by July").
  - Markers:
    - "costs start rising" at the first week where |dc_t| ≥ 2%;
    - a new marker at the peak week, using existing kind `shock`, e.g. "Cocoa peaks: +121%";
    - a marker for a fall of ≥ 10 points from the peak.
- **Tests:**
  - `price_end_week = 24` matches today's results bit-for-bit on the 4 examples (same seed). A surcharge 0→12 gives week-13+ prices equal to Do nothing.
  - A flat `cost_path` equal to `delta_c_raw` with `ramp_weeks=1, onset_week=0` matches the knob version when `scale` is pinned to 1. Add a test-only helper if needed.
  - A path that rises then falls makes "stock up now" beat "stock up at week 10".
  - Clamps hold.

## B. Cases and the as-of run
`fixtures/backtests/<id>.json`, one per case:

```
{ id, title, subtitle, as_of, horizon_weeks: 24,
  text,                 // how the owner would have described the business ON as_of (prices of that time)
  profile,              // human-checked parse of text, like fixtures/examples
  series: {file, column, unit, label, source_url, licence},
  path_index: "order_week" | "spot_week",
  what_happened: [{date, text, url}],   // written with hindsight, shown only in the reveal; every line sourced
  spoiler_terms: [str],                 // words that would show leakage, e.g. "145%", "peaked in April"
  caveats: [str] }
```

**The 4 cases.** The numbers below are what the Pink Sheet and BLS showed on 2026-10-21. Recompute them from the files, and if they differ, trust the files and say so.

| id | Business (owner's view) | as_of | Series | What it did over the next 24 weeks |
|---|---|---|---|---|
| `bt_robusta_2024` | The HCMC roaster: reuse `coffee_hcmc`'s profile with early-2024 prices | 2024-02-01 | Pink Sheet Coffee Robusta | 3.38 → 4.73 $/kg by July (**about +40%**, steady climb) |
| `bt_cocoa_2024` | A small chocolate maker (US or EU), bars and boxes | 2024-01-15 | Pink Sheet Cocoa | 4.40 → **9.74 in April (+121%)** → about 7–8 by July (**spike, partial fall**) |
| `bt_eggs_2025` | A US breakfast diner (eggs are a share of plate cost) | 2024-12-15 | BLS APU0000708111 | 4.15 → **6.23 in March (+50%)** → 3.78 in June (**−9%: full reversal**) |
| `bt_tariff_2025` | A US online shop selling China-made kitchenware, ocean freight | 2025-03-25 | **Policy step path** from the US tariff timeline on Chinese goods (no price file) | 20% extra duty → **145% from Apr 9–10** → **30% from May 14** (**spike and reversal**) |

**Case notes:**
- **`exposed_cost_share`.** Look up a sourced figure for each case and note the source in `caveats`. For example: cocoa's share of a chocolate maker's variable cost, eggs' share of a diner plate's food cost, and the duty's share of landed cost.
- **Retail vs wholesale eggs.** The BLS series is a retail price; diners buy wholesale, which swings harder. Say so in `caveats`, and don't swap in a source you can't cite.
- **Tariff timeline.**
  - Build the path from official or major-news sources: Federal Register / White House orders, plus Reuters or AP for the dates. List each step in `what_happened`.
  - Duty is paid at **entry**, so `path_index: "order_week"`: shift the path earlier by the profile's lead time. An order placed in week t pays the rate that applies at arrival.
  - Check whether de minimis or product exemptions apply to kitchenware, and note it.
  - Use `delta = (1 + duty_t)/(1 + duty_asof) − 1` on the dutiable share.
- **Monthly → weekly.** Treat each monthly value as the month's mid-point, interpolate linearly, then `path[t] = P(as_of + 7t days) / P(as_of) − 1`. The policy path is a step function by date. Put this in `backend/sim/backtest.py`. Keep it pure and tested.

**As-of run (`backend/sim/analysis.py` + `news_watch.py` + `prompts.py`):**
- `Analysis(..., as_of: date | None = None)`. When set:
  - **News.** Every Tavily search uses `start_date = as_of − 90 days`, `end_date = as_of`, and no `time_range`.
  - **Filter the results.** Drop anything with a missing or later `published_date`, or a URL or title dated after `as_of`. Count the drops.
  - **Cache keys** include the dates. No live "Check live news" in a backtest.
  - **Prompts.** Every Super and Ultra system prompt gets: "Today's date is {as_of:%d %B %Y}. You know nothing after this date. Use only the news below." Scenario 0b, the analyst and the memo all get the date line.
  - **Leak check (code, after the run).**
    - Scan the reasoning and outputs for each case's `spoiler_terms`, and for any date or month-year after `as_of`.
    - Also flag any numeric claim about the input's future price that matches the realised path within ±5 points.
    - Result: `leak_check {clean, flags: [{where, text}]}`.
    - Don't hide a flagged run. Show the flags in the reveal.
- **Freeze before recording.** Don't edit prompts, seeds or the case texts to improve a case's score. Record each case **once** after the prompts are final. If a run fails technically (timeout, fallback), you may re-run it; say so in the wrap-up. Tuning for the score is overfitting, and the judges' trust is the whole point.

## C. Scoring (`backend/sim/backtest.py`, engine only, free)
After the memo, build the `realized` ShockCase:
- `cost_path` from the series;
- other knobs at 0, except a sourced documented demand or lead-time change if one exists. Put it in the case JSON with its source, or leave it out.
- `likelihood: "likely"`, `label` like "What really happened: cocoa +121% then +75%".

Then run, on that one column, 1,000 paths, the same seed and common random numbers:
1. **Every plan the analysis tested.** That means seeds, Ultra rounds and the gut call.
2. **A hindsight sweep, to find the best plan in hindsight.**
   - Grid: price change {−5, 0, 3, 5, 8, 12}% × start week {0, 2, 4} × end week {12, 16, 24} × extra stock {0, 2, 4, 6, 8} weeks at week 0.
   - Run the sweep at 300 paths, then re-run the top 3 at 1,000.
   - This must stay under ~60 s locally, so vectorise or cut the grid.
   - Name the best plan in plain words.

The `backtest` event:

```jsonc
{ "backtest_id": "bt_cocoa_2024", "as_of": "2024-01-15", "horizon_end": "2024-07-01",
  "series": {"label": "World cocoa price", "unit": "$/kg", "source_url": "...", "as_of_value": 4.40,
             "points": [{"week": 0, "date": "2024-01-15", "value": 4.40, "change": 0.0}, ...]},
  "realized_case": ShockCase,                       // origin "realized", with cost_path and cost_line
  "cells": [{"plan_name", "mean_delta_usd", "p5_delta_usd", "p_better", "bridge"}],  // tested plans, realized column
  "pick": "Stock up 6 wk now", "pick_rank": 1, "n_plans": 7,
  "beat_do_nothing": true, "pick_delta_usd": 4200,
  "hindsight_best": {"name": "Stock up 8 wk + 5% wk 2", "spec": PlanSpec, "mean_delta_usd": 6100},
  "regret_usd": 1900,                               // hindsight_best − pick
  "baselines": [{"name": "Raise price 5% now", "mean_delta_usd": ...}, ...],
  "futures_cover": {"min": 0.10, "max": 0.45, "realized_peak": 1.21, "realized_end": 0.75,
                    "peak_inside": false, "end_inside": false},   // Ultra's futures vs reality
  "leak_check": {"clean": true, "flags": []},
  "dropped_news": 3,
  "what_happened": [{"date", "text", "url"}],
  "caveats": [str] }
```

Record it as the last event before `done` in `fixtures/replays/backtest_<id>.jsonl`. Also record one cell replay of the pick in the realized column (`cell_backtest_<id>_<plan-slug>_realized.jsonl`).

## D. Frontend
- **Screen 1.** Add a second row under the example cards: **"Real cases: would it have helped?"** Show 4 cards from `GET /api/backtests`, each with a date chip ("Jan 2024") and a one-line subtitle. In mock / offline mode, read the recordings directly, as the examples do.
- **During the run.** Show a quiet banner, "Replaying {as_of}: Dry Run only sees news from before this date." Everything else stays the same flow.
- **After the memo: the reveal.** Add a "What actually happened" panel with these parts:
  - **Price line.** The series over the 24 weeks, with an as-of marker and a dashed band for the range of Ultra's futures. This shows straight away whether reality fell inside it.
  - **Verdict line, in plain words.** For example "The memo's plan made $4,200 more than doing nothing", or "lost $1,300 vs doing nothing". After it: "Best plan in hindsight: … ($1,900 more)."
  - **Small table.** The pick, the baselines and the hindsight best, each with its $ vs Do nothing on the real path.
  - **Timeline.** The `what_happened` items with source links.
  - **Leak check.** A green "No hindsight in the reasoning" when clean. Otherwise amber, listing each flag.
  - **Caveats.** In the same style as the memo's "Not in these numbers" box.
  - **Replay button.** "Replay the real path", which opens the existing replay drawer with `shock_id: "realized"`.
- **Plan rows.** Show "until wk N" on plan rows and memo actions when `price_end_week < 24`. The add-plan panel gets an optional "Ends in week" field.
- **Styling.** Append a block at the end of `frontend/components/faces/dryrun.css` (pixel look, light and dark, 16px gutter at phone width, no horizontal scroll). Charts follow the existing heatmap and block-chart style.

## Spend (ask before the recording step)
- **Day-0:** under $0.05.
- **Recording.** 4 LIVE analyses at about $0.33 each, so **about $1.30–1.50**. That's over the $1 rule. **Get the user's OK before the first recording**, with your estimate from the Day-0 latency and token numbers.
- **Tavily.** Basic depth only, about 8–12 credits per case, all cached.

## Tests and checks
- **Pytest:**
  - the engine tests in Part A;
  - the weekly interpolation and the policy step path (including the `order_week` shift);
  - the as-of news filter (a result dated a day after `as_of` is dropped);
  - leak-check hits and misses;
  - the `backtest` event shape;
  - `GET /api/backtests`;
  - the backtest replay stream through the API with the fake router.
- `uv run pytest -q`, `uv run ruff check backend tests`, `npm run build` and the frontend tests all clean.
- **In the app** (`./dev.sh`, free, replay): open each of the 4 cases, check the reveal and the realised-path replay, and check phone width and dark mode. Use the built-in browser and take screenshots.

## Out of scope
- Demand-side realised data (sales volumes), and more than one input per case.
- Live backtests on any date the user picks. A good follow-up, but it needs a price-series picker.
- Wholesale egg data behind a paywall.

## Wrap-up
- **Docs:**
  - EVENTS.md v2.2 and SPEC §15.4, §15.5, §15.10 and new §15.12, as approved;
  - FEEDBACK_LOG rows for the Tavily date window and the model cutoff;
  - tick B1 on `prompts/README.md`.
- **Report.** In the wrap-up, list each case's verdict honestly: beat Do nothing or not, regret, futures covered or not, leak check. These lines go into the README and the video, whatever they say.
