# P4: Analysis orchestrator, cell replay and headless CLI (Milestone A)

| | |
|---|---|
| Builder | **Claude Code**: **Opus 5.5**, effort high. This is the integration piece; it replaces the retired T07. |
| Start | New Claude Code session in this folder → pick that model → type: `Do the task in prompts/3c_oct18_one-task/P4-analysis-orchestrator.md` |
| Parallel with | F1–F3 (Argon, frontend). No shared files. |
| Time | ~4 h |
| Depends on | P1, P2, P3 committed |
| Target date | Oct 18 (**Milestone A**: a headless end-to-end analysis) |
| Live spend | ≤ $0.40 including the recordings. Ask me first. |

---
You are wiring the pivot together: one "analysis" from business profile to memo, the week-by-week replay of any grid cell, and the recordings that REPLAY mode plays for judges.

**Read only these:**
- `SPEC.md` §15, §7, §7.1
- `docs/EVENTS.md` v2.1 (the whole contract)
- the public APIs of `backend/engine/planner.py`, `backend/agents/*`, `backend/services/*`
- `fixtures/examples/*.json`

**`backend/sim/analysis.py`: `class Analysis(*, profile, example=None, mode, router, scout, telemetry, seed=0)`**
- `async run(emit)`:
  1. emit `analysis`;
  2. `planner.calibrate`;
  3. `NewsWatch.find`, then emit `news`;
  4. run `Analyst`. It runs step 0b (futures) first and emits `scenarios` + `shocks` itself (SPEC §15.6 v3.1), falling back to `default_shock_cases`;
  5. emit `telemetry` after every LLM call (throttled to ≥ 1 s apart) and at the end;
  6. emit `done` with the cost.
- `async add_user_plan(spec, emit)`: clamp, evaluate every column (2–6) with the same seed and the plan's crowd. Crowd is neutral in REPLAY, so it stays free; in LIVE there's one Lightning pair. Emit `plan` (source `user`) + `grid_cell`s + `grid_summary`. At most 4.
- `async news_check(emit)`: delegates to `NewsWatch.check`, then emits `news`.
- `job_payload() -> dict`: the `planner.run_job` input for the 10,000-per-cell Serverless Job (T09). Contents: the profile, every plan, the shocks, each plan's crowd, and the seed.
- `memo_markdown() -> str`: the memo as Markdown, with the grid row of the picked plan, the cost line, the P&L breakdown, the cash line, the "Not in these numbers" box and the sources.
- Keep the state needed for these: profile, calibration, shocks, plans, crowd per plan, cells, summary, memo.

**`backend/sim/replay_cell.py`: `async play_cell(analysis_state, plan_name, shock_id, emit, *, week_seconds=0.75)`**
- Calls `planner.simulate_detail`.
- Emits `replay_start`; then per week the U1 and U2 `tick` events (U1 gets `choices_b64` from `choices`) and that week's `marker`s; then `replay_done`.
- `bullwhip` is computed from the week's demand and order history (§4.5). It's `null` before week 8.

**`backend/sim/cli.py`**: `uv run python -m backend.sim.cli --example coffee_hcmc | --text "…" [--cheap] [--offline] [--record]`
- Prints the analyst steps, the final grid as a table and the memo headline.
- `--cheap` sends the analyst calls to Super instead of Ultra (the SPEC §7.1 dev rule).
- `--offline` uses cached Tavily and a fake router that returns scripted decisions.
- `--record` writes the analysis stream to `fixtures/replays/analysis_<example>.jsonl`, plus the cell replay of the memo's plan in the `news` column, in the EVENTS.md replay format.
- Also `--replay-cell PLAN SHOCK` for one cell from the last analysis.

**Replay player:** extend `backend/services/replay.py` (keep its API) so a recorded analysis can be played at a chosen speed, and `play_cell` can be served from a recording when one exists.

**Tests: `tests/test_analysis.py`** (fake router and scout, `week_seconds=0`, seeded):
- A full analysis emits every v2 event type in a valid order, with keys matching EVENTS.md.
- `add_user_plan` in REPLAY makes no LLM call and returns cells equal to `planner.evaluate_cell`.
- `play_cell` emits 24 weeks × 2 ticks, `choices_b64` decodes to `n_consumers` values, and markers have ≤ 14 words.
- `job_payload` round-trips through `planner.run_job` at n = 200.
- A recorded analysis replays with the same events.

**Milestone A.** Ask me before each live step; give the estimated cost each time.
1. `--example coffee_hcmc --cheap` (≈ $0.02).
2. `--example coffee_hcmc` at full cost (≈ $0.08–0.12).
3. Then `--record` for all three examples at full cost (≈ $0.30) **only after I've looked at step 2's memo.**

Report the spend from telemetry, the final grid and the memo for step 2. Add any quirks to `docs/FEEDBACK_LOG.md`.

Commit as `P4: analysis orchestrator, cell replay, CLI (Milestone A)`. Commit the recordings separately as `P4: record example analyses`.

## Review addition (2026-10-15): the owner's gut-check plan
From `docs/wrapups/wave3-argon-verdict.md` §C 8.1. It's the video's hook: the owner's instinct gets tested next to Ultra's plans.
- `start_analysis(..., gut_plan: PlanSpec | None = None)`. If given, it's simulated with the seed plans, named "Your gut call: {name}", `source: "user"` (the existing user-plan path). Ultra sees it in the results table like any other plan, and the prompt says "the owner's own idea" so Ultra can explain why it beats it, or doesn't.
- 3 preset gut plans per example, in `fixtures/examples/*.json` as `gut_plans` (e.g. coffee: "Raise price 10% now", "Stock up 4 weeks now", "Wait and see" = Do nothing, which is shown as a no-op note instead of a row).
- Record each example replay **with** a gut plan (coffee: "Raise price 10% now"). **Record only after P2b** (recalibrated engine).
- API: `POST /api/analyses` takes an optional `gut_plan` (a `PlanSpec`). That's an EVENTS.md change, so ask the user, then mark it "(review)" in the REST table.
