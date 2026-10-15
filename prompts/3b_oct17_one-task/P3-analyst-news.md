# P3: Analyst loop, shopper reactions and news watch

| | |
|---|---|
| Builder | **Claude Code**: **Sonnet 5.5**, effort high |
| Start | New Claude Code session in this folder → pick that model → type: `Do the task in prompts/3b_oct17_one-task/P3-analyst-news.md` |
| Parallel with | F0 (Argon, frontend shell). No shared files. |
| Time | ~5 h (v3.1 adds ~1 h) |
| Depends on | P1 and P2 committed |
| Target date | Oct 17 |
| Live spend | ≤ $0.25. Ask me before the live part. |

---
You are building the agent half of the pivot: Nemotron Ultra working as an analyst, using the engine planner as its tool (SPEC §15.6), plus the news search for one business (SPEC §15.7).

**Read only these:**
- `SPEC.md` §15 (all of it), §6, §7.1
- `docs/EVENTS.md` v2: the `news`, `plan`, `crowd`, `grid_cell`, `grid_summary`, `agent_step`, `reasoning` and `memo` events
- the public APIs of:
  - `backend/engine/planner.py`
  - `backend/agents/schemas.py`
  - `backend/agents/prompts.py`
  - `backend/services/router.py`
  - `backend/services/tavily_scout.py` (`search`, `extract`, `_pipeline`, `verify_evidence`)
  - `backend/services/telemetry.py`
- `fixtures/examples/*.json`

**`backend/services/news_watch.py`: `class NewsWatch(scout, router)`**
- `async find(profile, *, fallback_shock, live: bool) -> dict`
  - Returns `{items, used_for_grid, news_shock}`, where `items` match the `news` event.
  - Follow SPEC §15.7: search each `search_terms` entry, merge and deduplicate, drop non-article URLs, then Super-parse the top 3 with verified verbatim quotes.
  - `impact_usd` and `impact_p5_usd` come from `planner.evaluate_cell` ("Do nothing" under that shock vs no shock, 500 paths).
  - Offline or no usable article → one item built from `fallback_shock`, labelled as the example's assumption.
- `async check(profile) -> dict`: "Check live news". One fresh `basic` search, extract, parse, and one `news` item with `live: true, applied: false`. Report credits used.

**`backend/agents/analyst.py`: `class Analyst(router, cal, profile, news, shocks, emit, *, max_rounds=3, max_plans=8, n_paths=1000, seed=0)`**

`async run() -> dict` follows SPEC §15.6:
1. **Seed.** Emit a `plan` event for each seed plan. Get the crowd for each (step 3), evaluate them, and emit `grid_cell`s, then `grid_summary`.
2. **Rounds.**
   - Call Ultra with `analyst_messages` (thinking ON, `role="analyst"`). Stream reasoning out as `reasoning` events through `on_reasoning`.
   - Emit an `agent_step` (`kind: "think"`) with `thought`.
   - For each new plan: clamp it, rename duplicates, emit `plan` (source `ai`) and an `agent_step` `test`. Get the crowd (step 3), then evaluate the plan in all columns with `planner.evaluate_grid`, passing the same seed so common random numbers hold.
   - Emit the cells, plus an `agent_step` `result` with the plan's `news` column in plain words ("+$5.0k on average · bad case +$1.2k").
   - Emit `grid_summary` after each round.
   - Stop on `finish`, `max_rounds` or `max_plans`.
3. **Shoppers per plan.**
   - Two parallel Lightning calls (6 groups each) with `plan_crowd_messages`, merged with `crowd_to_sentiment`.
   - Emit `crowd` and one `agent_step` `shoppers` quoting the most telling bubble.
   - Run the 4 seed/first-round crowd calls concurrently. The limiter already drops crowd calls first under pressure.
4. **Memo.**
   - Ultra (thinking OFF) with `memo_messages` for the pick.
   - If Ultra's pick isn't a tested plan, use `best_today`.
   - Build the `memo` event: the numbers from the `news` column cell, and the sources from the news items.
5. **Fallbacks** (SPEC §15.6): each one emits `agent_step` `fallback` and marks `fallback_used`.
   - Ultra fails twice in a row → the deterministic search, then a template memo.
   - Crowd fails → neutral sentiment.
- **Return** `{plans, cells, summary, memo, crowd}`.
- **Never block the event stream on an LLM.** Emit engine results as soon as they're computed.

**Plain-words helpers: `backend/agents/wording.py`**
- `usd_k(x)` formats like "+$5.0k" / "−$1.8k", with a real minus sign.
- `result_line(cell)`
- `results_table(cells, shocks)`: the compact text table `analyst_messages` takes.
- These are shared with the frontend copy, so keep them consistent with DESIGN.md §6 money rules.

**Tests: `tests/test_analyst_news.py`** (fake router with scripted replies and latencies; fake scout; no network):
- A full run on `coffee_hcmc`:
  - seeds, then 2 rounds, then finish, then the memo;
  - the event order and keys match EVENTS.md v2;
  - ≤ 8 plans;
  - the cells for seed plans are identical to calling the planner directly.
- Ultra returns a duplicate plan name → it's renamed, never re-tested.
- Ultra fails twice → the deterministic fallback runs, and the memo has `fallback_used: true`.
- Crowd failure → neutral sentiment, and the run still completes.
- News: non-article URLs are dropped. Offline → the fallback item. Every quote is a verbatim substring of its article.

**Live run.** Ask me first; expect ≈ $0.06–0.12.
- `uv run python -m backend.agents.analyst --example coffee_hcmc --live` (add this small `__main__`). It prints the `agent_step` texts, the final grid as a table, and the memo.
- Paste them in your reply.
- Add anything surprising to `docs/FEEDBACK_LOG.md`.

**Done when** pytest and ruff pass. Commit only your files as `P3: analyst loop, shopper reactions, news watch`.

## v3.1 realism update (2026-10-15): also build this

SPEC §15 v3.1 and EVENTS v2.1 win over anything above that conflicts.

- **News (§15.7):**
  - Run up to 2 `market_terms` searches with `topic: "general"`, `country=profile["country"]` (skip the boost if it's `""`), `time_range: "month"` and `basic`, all cached.
  - Add `country` as an optional parameter to `TavilyScout.search`. It's only sent with `topic: "general"`; Tavily ignores it for news.
  - Market items get `kind: "market"`, ids `m1…`, a ≤ 200-char snippet in `quote`, and `shock`/`cost_line`/impact set to `null`. Supply items get `kind: "supply"`, ids `n1…`, and a `cost_line`.
  - ≤ 5 credits per analysis. Report the credits used.
- **Step 0b, futures (§15.6):** `Analyst.scenarios()` runs before the seed plans.
  - Call Ultra with `prompts.scenario_messages` (thinking ON, reasoning as `role: "scenarios"`, round 0) and validate a `ScenarioSet`.
  - Apply the code rules: clamp, drop all-zero cases, drop near-duplicates (all knobs within 2 points), drop unknown `source_ids`, assign ids `s1…`, keep ≤ 5.
  - The `news` case comes first. If fewer than 2 cases survive, fall back to `default_shock_cases` and emit an `agent_step` `fallback`.
  - Emit `scenarios` and then `shocks`. Note: P4's orchestrator now gets the shocks from here instead of calling `default_shock_cases` itself.
- **`wording.py`:**
  - `cost_line(profile, case)` → "Beans +31% × 85% of your cost is beans = your cost +26% (+$1.71 a bag)", using `planner.cost_change`. Name the input from `product_unit` with a short word ("beans", "cards", "timber"), falling back to "the main input".
  - `bridge_lines(bridge)` → the five plain labels from DESIGN.md §12.3a, plus the total.
  - `results_table` adds `steady`, `cash` and `OVER CASH` for the `news` column.
  - `futures_block(shocks)` lists the columns for `analyst_messages(futures_block=...)`.
- **Memo event (EVENTS v2.1):**
  - `numbers` gains `bridge`, `steady_rival_delta_usd`, `peak_cash_usd`, `payback_week`, `over_cash` and `cash_available`; the memo also carries `cost_line`.
  - `not_modelled = {fixed: SPEC §15.11's list (a constant in wording.py), found: the ScenarioSet's unmodelled}`, with `source_id` `""` → `null`.
  - The `numbers` passed to `memo_messages` include the bridge, so Ultra may cite those figures.
- **Extra tests:**
  - The scenario step's code rules (duplicates, zero cases, bad source ids, too few → fallback).
  - A market search sends `country` + `topic: general`.
  - The `cost_line` arithmetic matches `planner.cost_change`.
  - The memo has `not_modelled.fixed` and the bridge.
- **Live run** now also prints the futures Ultra picked and its `unmodelled` list.

## Review additions (2026-10-15, from `docs/wrapups/wave3-argon-verdict.md` §B and §C)

**Order:** build and test offline as usual, but **do the live run only after P2b is committed.** P2b recalibrates the engine, and the live grid must use the new numbers.

- **`_ANALYST_SYSTEM`** (`backend/agents/prompts.py`). Replace "Try a different idea each time…" with ideas to try across rounds. They are suggestions, not rules:
  1. **Staged timing:** buy stock early (`stock_week` 0) to lock in today's cost, then a smaller price rise later, around when the cheap stock runs out (≈ onset + lead time).
  2. **Partial hedge within cash:** when `cash_available > 0`, a 2–3 week stock-up that stays under the cash limit, combined with a supplier switch or a modest marketing push to hold customers.
  3. **Fix the weak spot:** in rounds 2–3, look at the plan's worst bad-case column and which P&L line drives it (cheaper stock vs customers lost), and propose a variant that addresses it.

  Keep the existing rules (bad case, steady rival, cash). Keep the prompt under its current token budget.
- **`_SCENARIO_SYSTEM`**: add "Futures worth considering when the news gives any reason", using the existing knobs only:
  - cost up **and** demand down;
  - the rival holds or cuts its price (`rival_price_change_pct` −5 to −10);
  - delays longer than the supplier lead time (`delta_lead_time` +3 to +6);
  - a **false alarm** (the input price rise fades: `delta_c_raw` near 0 or slightly negative). This is the case that punishes over-stocking.
- **The input change vs your cost change.** In `scenario_messages`, show the headline as two named numbers: "input price +31% (use this for delta_c_raw); your cost +26% after the 85% share (do not use this)". A test checks the text.
- **Step 0b validators** (`Analyst.scenarios()`), each logged in a `fallback`-style `agent_step` only when it changes something:
  1. `rival_price_change_pct` or `share_shift_pct` with 0 < |v| < 1 → × 100 (Ultra sent a fraction).
  2. If no case has `delta_c_raw` below the news case's, insert `default_shock_cases(...)`'s `mild` (`origin: "default"`).
  3. Drop market ids (`m…`) from `source_ids` on a case whose demand, rival and share knobs are all 0 (cost-only case). Keep the case.
  4. The existing rules: clamp, zero cases, near-duplicates, unknown ids, ≤ 5.

  Add one test per new rule.
- **News URL filter** (`news_watch.py`): before any extract, drop URLs matching `(?i)/sitemap|/tag/|/tags/|/page/\d+|/index(\.html?)?$|/quote/|/ticker|/markets/data` and results whose snippet is ≤ 80 characters. Log the count dropped. This saves extract credits; see the FEEDBACK_LOG row from 2026-10-14.
- **Memo fields for the UI** (`memo` event, code-built, never LLM numbers):
  - `actions`: the pick's `PlanSpec` as week-by-week steps (`[{week, text}]`, e.g. `{week: 0, text: "Order 4 extra weeks of beans (about $7.3k)"}`, `{week: 5, text: "Raise price 10% ($11.00 → $12.10)"}`). Build them in `wording.plan_actions(plan, profile, cell)`.
  - `runner_up`: `{name, mean_delta_usd, p5_delta_usd}` of the second-best plan in the `news` column, so F3 can show "Why not {runner-up}?". The text can come from Ultra's `why` only if it names that plan; otherwise use a template.

  Add both to EVENTS v2.1's `memo` row, marked "(review)", **after asking the user** (it's a contract).
