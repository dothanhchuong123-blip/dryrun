# P3: Analyst loop, shopper reactions and news watch

| | |
|---|---|
| Builder | **Claude Code**: **Sonnet 5.5**, effort high |
| Start | New Claude Code session in this folder → pick that model → type: `Do the task in prompts/3b_oct17_one-task/P3-analyst-news.md` |
| Parallel with | F0 (Argon, frontend shell). No shared files. |
| Time | ~4 h |
| Depends on | P1 and P2 committed |
| Target date | Oct 17 |
| Live spend | ≤ $0.20. Ask me before the live part. |

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
