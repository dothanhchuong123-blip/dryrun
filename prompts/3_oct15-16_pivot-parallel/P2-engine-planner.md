# P2: Engine planner (calibration, plans, plans × shocks grid, cell replay)

| | |
|---|---|
| Builder | **Claude Code**: **Opus 5.5**, effort high (this is the core of the pivot, and math-heavy) |
| Start | New Claude Code session in this folder → pick that model → type: `Do the task in prompts/3_oct15-16_pivot-parallel/P2-engine-planner.md` |
| Parallel with | F0 (frontend shell): no shared files |
| Time | ~5–6 h (v3.1 adds ~1.5 h) |
| Depends on | T01–T03 committed (done) |
| Target date | Oct 15–16 |

---
You are building the planner: the engine module that tests a small business's plans against shocks. It is pure, seeded NumPy code with no I/O and no LLM calls.

**Read these first:**
- `SPEC.md` §15.2–15.5 and §15.9 (including the **v3.1** parts and §15.5.1–15.5.2): **the spec for this task, follow it exactly**
- `SPEC.md` §4.1–4.5 and §4.7
- `backend/engine/types.py`
- the public functions in `backend/engine/market.py`, `inventory.py` and `montecarlo.py`, especially `_simulate_universe`, `_archetype_choice_probs`, `_sample_multinomial_crn` and `_pregenerate_crn_streams`

**Only create:** `backend/engine/planner.py` and `tests/test_planner.py`. **Do not edit** `market.py`, `montecarlo.py` or `types.py`: their tests must keep passing. Import their helpers; where a private helper doesn't fit, copy the logic into `planner.py` with a comment saying where it came from.

**Data types** (dataclasses in `planner.py`):
- `PlanSpec`: exactly the SPEC §15.4 fields, with the defaults of "Do nothing".
  - Also `PlanSpec.do_nothing()` and `clamp()`, which clips to the §15.4 bounds.
- `ShockCase`: §15.5 fields.
- `Calibration`:
  - `params: MarketParams`, `archetypes: Archetypes`
  - `k_p`, `k_q`, `d0`
  - `rival_markup`
  - `init: dict` (starting stock levels)
  - `profile: dict`

**Functions:**
- `calibrate(profile: dict, seed=0) -> Calibration`: SPEC §15.3. Build `MarketParams` with `dataclasses.replace`. Compute `d0` from the expected MNL demand at the starting prices.
- `default_shock_cases(news_shock: dict, profile: dict) -> list[ShockCase]`: SPEC §15.5.
  - Labels name the input in plain words, using `profile["product_unit"]` to pick a short word where possible, and fall back to "Costs" ("Costs +31%").
  - The `news` label ends with "(today's news)".
- `evaluate_grid(cal, plans, shocks, crowd=None, horizon=24, n_paths=1000, seed=0) -> dict`
  - `crowd` maps plan name → `CrowdSentiment`. A missing name means neutral (μ = 0, σ = 0.1).
  - "Do nothing" is always simulated as the reference, even if not passed.
  - Returns:
    - `{"cells": [{plan_name, shock_id, n, mean_delta_usd, p5_delta_usd, p_better, mean_profit_usd}], "baseline_profit_usd": {shock_id: usd}, "best_today": name, "safest": name}`
    - The cells exclude "Do nothing".
  - **Vectorise.** Stack plans × paths on one axis, and loop over weeks only.
  - **Common random numbers per column:** every plan and "Do nothing" in a shock column see identical noise streams.
- `evaluate_cell(cal, plan, shock, crowd=None, horizon=24, n_paths=1000, seed=0) -> dict`: one cell, for user-added plans.
  - It must return the **same numbers** as that cell inside `evaluate_grid` for the same seed.
- `simulate_detail(cal, plan, shock, crowd=None, horizon=24, seed=0) -> dict`: SPEC §15.9.
  - Returns:
    - `{"weeks": [{"U1": tick_dict, "U2": tick_dict}], "markers": [{week, kind, firm, text}], "n_consumers": N}`
    - `tick_dict` has every key of the `tick` payload in `docs/EVENTS.md` except `choices_b64`, with money in USD and quantities in real units (× `k_q`). Instead of `choices_b64`, U1 carries `choices`: an int8 list of length N, synthesised from the archetype counts in a fixed order, so the same consumer index keeps the same archetype.
  - Marker texts are ≤ 14 words, plain English: "Bean costs start rising", "Highland Supply sold out", "Extra stock arrives (4 weeks' worth)".
- `run_job(job: dict, n_paths: int) -> dict` and a CLI: `python -m backend.engine.planner --job in.json --n 10000 --out out.json`.
  - `job = {profile, plans: [PlanSpec dict], shocks: [ShockCase dict], crowd: {name: {mu, sigma}}, seed}`
  - Output is the `evaluate_grid` result. Chunk paths so memory stays under ~2 GB.

**Mechanics** (SPEC §15.4, read carefully):
- **Purchase-cost accounting:** track the raw stock's value per firm per path. Orders are priced at the week they're placed, and production uses the weighted-average cost.
- **The one-off extra order** goes into the pipeline at `stock_week`.
- **Supplier switch:**
  - New orders use `alt_lead_time_weeks`.
  - Unit cost × (1 + `alt_cost_change_pct`/100).
  - Only `alt_shock_exposure` of the shock's cost rise.
- **Shock ramp:** onset week, then a linear ramp.
- **Production plan** = 4-week moving average of own demand + 10%.
- **The rival rule:** keeps its markup; if more than 5% above A for 2 weeks, it moves to A + 2%.
- **Optional "Textbook price rule" plan:** a `PlanSpec` whose `name == "Textbook price rule"` makes A's price = `ATC × (1 + markup)` each week, with A's starting markup.

**Tests: `tests/test_planner.py`** (seeded, no I/O):
- **Calibration:** on the `coffee_hcmc`-style profile from `docs/EVENTS.md`, "Do nothing" with no shock gives mean weekly sales of A within ±10% of `weekly_sales`, and mean weekly gross profit within ±15% of `(price − unit_cost) × weekly_sales`.
- **Common random numbers:** a plan identical to "Do nothing" gives `mean_delta_usd == 0` and `p5_delta_usd == 0` exactly.
- **Purchase cost:** with a +40% cost shock starting in week 2, "Stock up 4 weeks in week 0" beats "Do nothing" on mean. With no shock, it's worse (it pays holding cost).
- **Supplier switch:** with `alt_shock_exposure = 0` and a big cost shock, the switch beats "Do nothing" in the `news` column.
- **Rival rule:** after A cuts its price by 10%, B's price is within A + 2% two to three weeks later.
- `evaluate_cell` equals the matching cell of `evaluate_grid`.
- `simulate_detail`: 24 weeks, all `tick` keys present, `len(choices) == n_consumers`, and markers include the shock onset.
- **Performance** (measure it): `evaluate_grid` with 8 plans × 6 shocks × 1,000 paths × 24 weeks, both rival variants, in < 6 s; `evaluate_cell` < 0.5 s.
- `run_job` round-trips through JSON.

**Done when** pytest and ruff pass. Commit as `P2: engine planner (calibration, plans, grid, cell replay)`.

## v3.1 realism update (2026-10-15): also build this

SPEC §15 v3.1 and EVENTS v2.1 win over anything above that conflicts.

- **`ShockCase`** gets the v3.1 fields: `rival_price_change_pct`, `share_shift_pct`, `likelihood`, `why`, `source_ids` and `origin`, with defaults 0 / 0 / `"likely"` / `""` / `[]` / `"default"`. `default_shock_cases` sets `origin: "default"`.
- **Cost exposure (§15.5.1):** unit cost in week t = `unit_cost × (1 + exposed_cost_share × delta_c_raw × ramp(t))`, and also × `alt_shock_exposure` after a supplier switch. If the profile has no `exposed_cost_share`, read it as 1.0. Export a pure helper `cost_change(profile, case) -> {pct, usd_per_unit}` so the wording code uses the same formula.
- **New knobs:**
  - `rival_price_change_pct` multiplies B's rule price by (1 + pct/100) from `onset_week`.
  - `share_shift_pct` scales A's expected demand by (1 − pct/100 × ramp(t)). The lost customers leave the market; they don't go to B.
- **Rival stock:** B's starting raw stock is U(1, 4) × d0, drawn per path inside the common random numbers.
- **Extra cell fields (§15.5.2):**
  - `bridge` {`cost_usd`, `price_usd`, `volume_usd`, `marketing_usd`, `holding_usd`}, which must sum to `mean_delta_usd` within $1, with no "other" line;
  - `steady_rival_delta_usd`: the same random numbers with B's raw stock unlimited. Add `evaluate_grid(..., steady_rival=True)` so tests can turn it off;
  - `peak_cash_usd`, `payback_week`, `over_cash`. Cash = revenue − orders paid in the week placed − marketing − holding. `over_cash` uses `profile["cash_available"]` (0 = no check).
  - `best_today` and `safest` skip `over_cash` plans unless every plan is over, and `safest` ignores `unlikely` columns.
- **`simulate_detail`:** each tick also carries `unit_cost`, `cover_weeks` and `in_transit`, and U1 carries `cum_cash_delta`. Add the markers `rival_price` and `new_player`.
- **Extra tests:**
  - With `exposed_cost_share = 0.5`, the cost rise is exactly half that at 1.0.
  - The bridge sums to the mean for 3 different plans.
  - A plan identical to "Do nothing" has every bridge line == 0.
  - A plan that wins only by the rival running out shows `steady_rival_delta_usd < mean_delta_usd`.
  - A 4-week stock-up for `coffee_hcmc` has `peak_cash_usd` ≈ 4 × 280 × $6.50 (±15%), with `over_cash` false at $8,000 and true at $5,000.
  - `share_shift_pct = 20` cuts A's mean sales by roughly 20% after the ramp.
  - `rival_price_change_pct = -10` moves B's price.
