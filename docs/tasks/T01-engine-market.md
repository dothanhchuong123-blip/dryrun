# T01: Engine (choice, costs, clearing, goodwill, baseline)

| | |
|---|---|
| Model | **Sonnet 5.5**, effort medium |
| Time | ~3 h |
| Depends on | nothing |
| Run in parallel with | T02, T04, T05, T10 |

---
You are implementing the deterministic market engine for the Market Digital Twin project.

**Read only these:**
- `SPEC.md` §4.1, §4.2, §4.3, §4.7
- `backend/engine/types.py`. This is a shared contract: **don't change it.** If you think it must change, stop and explain why.

**Rules for `backend/engine/market.py`:** pure functions, vectorised NumPy, no I/O, no LLM calls. `costs`, `clear_market` and `update_goodwill` must **broadcast over leading batch dimensions** (shape `(..., 2)`), because T03 reuses them for a vectorised Monte Carlo.

**Implement in `backend/engine/market.py`:**
1. `make_archetypes(n_consumers, rng) -> Archetypes`
   - 12 archetypes, IDs 1..12 in this nested order: income ∈ {low, mid, high} × sensitivity ∈ {hunter, moderate} × loyalty ∈ {A, B}. T05 builds `fixtures/archetypes.json` in the same order.
   - Spread consumers evenly across archetypes (shuffle with `rng`).
   - Give each a readable label, e.g. `"Low-income · price-hunter · A-loyal"`.
   - Loyalty bias: +0.3 utility toward the loyal brand.
2. `sample_alpha(arch, rng) -> (N,)`: lognormal price sensitivity. Calibrate so that α·P at P ≈ 100 is comparable to `beta_bar` (α ≈ 0.02–0.06). Hunters get a higher α.
3. `sample_sentiment(crowd: CrowdSentiment, arch, rng) -> (N, 2)`: draw from Normal(μ, σ) for each consumer's archetype, then clip to [-1, 1].
4. `choice_probabilities(price, marketing, beta0, alpha, sentiment, loyalty_per_consumer, params) -> (N, 3)`: MNL with an outside good. Columns are `[outside, A, B]`. Use log-sum-exp for stability.
5. `costs(q, c_raw, params) -> (tc, mc, atc)`: include the `max(Q, 1)` guard in ATC.
6. `clear_market(demand, inventory, theta) -> dict(own_sales, spill_in, sales, unmet, lost)`: exactly SPEC §4.3 steps 1–4. Symmetric, and spillover is capped by the rival's spare stock.
7. `update_goodwill(beta0, unmet, demand, params) -> beta0_new`: SPEC §4.3 step 5, with ε = 1e-6.
8. `elasticities(...) -> (own, cross)` for firm A, by ±1% numerical perturbation of price.
9. `step(state, decision, shock, sentiment, arch, alpha, params, rng, inventory_policy=None) -> (MarketState, TickResult)`
   - Runs the full canonical tick from SPEC §4.7.
   - For step 8, call `inventory_policy(state, params, lead_time) -> (orders (2,), rop (2,))` and append the orders to the pipeline at `t + lead_time`. T02 writes the real policy. Until then, the default placeholder orders up to 2× recent mean demand when `raw_inv` is below 1× mean demand; mark it `# replaced by inventory.replenish (T02)`.
   - Never mutate the input state. Return a new `MarketState`.
   - Append the effective demand and the orders to `demand_hist` / `order_hist`.

**Implement in `backend/engine/baseline.py`:**
- `cost_plus_decision(state, last_result, params, marketing) -> (price, plan, marketing)` for firm A:
  - price = ATC(Q_{t−1})·(1+markup)
  - plan = 4-tick moving average of A's demand
  - marketing stays constant
- `clamp_decision(price, plan, marketing, mc, atc, k_cap)`: price ∈ [0.5·MC, 4·ATC], plan ∈ [0, k_cap], marketing ≥ 0. This is reused for LLM outputs.

**Tests in `tests/test_market.py`** (seeded; whole file under 2 s):
- Probability rows sum to 1.
- Raising P_A lowers A's share and raises both the outside and B shares.
- Raising both prices by 20% raises the outside share.
- Marketing has diminishing returns.
- Spillover:
  - an A stockout with slack at B sends B min(θ·unmet, spare);
  - the symmetric case works;
  - no value is ever negative;
  - conservation holds: `sum(own_sales) + sum(spill_in) + lost == sum(demand)`.
- Goodwill drops after a stockout and mean-reverts afterwards.
- `costs`: MC and ATC match their formulas; ATC is finite at Q = 0; `costs` broadcasts over a (100, 2) batch.
- `step()`:
  - the same seed gives the same result;
  - inventory and raw inventory are never negative;
  - profit equals revenue minus all cost terms;
  - 500 consumers run in < 20 ms per step.

**Done when** `uv run pytest -q` and `uv run ruff check backend tests` both pass. Commit as `T01: market engine + baseline`. Reply with a 5-line summary of the public API.
