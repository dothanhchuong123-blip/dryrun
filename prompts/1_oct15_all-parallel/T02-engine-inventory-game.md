# T02: Engine ((s,S) inventory, bullwhip, game theory)

| | |
|---|---|
| Builder | **Gemini 4 Argon**, Pro account #2. Then a short Claude check (Sonnet 5.5, effort medium). |
| Start | Run `uv run scripts/argon.py pack T02`, then follow `prompts/argon/HOW-TO.md` → "Build a task" |
| Parallel with | T01, T10 (Argon) · T04, T05 (Claude) |
| Time | ~3 h |
| Depends on | nothing |

---
You are implementing the inventory policy and the game-theory module of the Market Digital Twin engine.

**Read only these:**
- `SPEC.md` §4.4, §4.5, §4.7
- `backend/engine/types.py`. This is a shared contract: **don't change it.**

All code is pure NumPy with no I/O.

**`backend/engine/inventory.py`:**
- `reorder_point(mu_d, sigma_d, lead_time, z, omega) -> (2,)`: the SPEC §4.5 formula.
- `replenish(state: MarketState, params: MarketParams, lead_time: int) -> tuple[orders (2,), rop (2,)]`
  - Take μ and σ from the last 8 entries of `state.demand_hist`. With fewer than 2 ticks of history, use μ = last demand (or k_cap/2) and σ = 0.2·μ.
  - Inventory position = raw_inv + that firm's pipeline quantities.
  - If position ≤ ROP, order up to S = ROP·`order_up_to_mult`.
  - Pure: just return the orders. `market.step` (T01) appends them to the pipeline.
- `bullwhip_ratio(order_hist, demand_hist) -> list[float | None]` (one per firm)
  - Return `None` with fewer than 8 ticks of history, or when Var(demand) == 0.
  - Use ddof=1.

**`backend/engine/game.py`** (index convention: 0 = cut, 1 = hold, 2 = raise):
- `payoff_matrix(price, profit_fn, deltas=(-0.10, 0.0, 0.10)) -> (pa 3x3, pb 3x3)`
  - `profit_fn(price_A, price_B) -> (π_A, π_B)` is injected; T07 passes a closure over expected demand.
  - Rows are A's action, columns are B's.
- `nash_equilibria(pa, pb) -> (pure: list[tuple[int, int]], mixed: dict | None)`
  - Find pure NEs with a best-response check.
  - Only if none exist, find a mixed NE with `nashpy` support enumeration (take the first): `{p_A: [3], p_B: [3]}`.
- `classify(chosen, pa, pb, pure) -> "nash" | "price_war" | "collusion" | "other"`: the definitions in SPEC §4.4.
- `action_index(prev_price, new_price, band=0.03) -> int`: within ±3% counts as hold.
- `best_response(pa, rival_action) -> int`: used by T07 as the CEO fallback.

**Tests in `tests/test_inventory_game.py`:**
- A higher ω gives a higher ROP.
- A lead-time spike combined with ω = 1.0 and noisy demand produces bullwhip > 1 over a 40-tick synthetic run.
- ω = 0 with constant demand produces no phantom orders.
- A textbook Prisoner's Dilemma has pure NE (cut, cut), labelled `price_war` when chosen.
- A coordination game finds 2 pure NEs.
- Matching pennies gives a mixed NE of ≈ (0.5, 0.5).
- A collusion case is labelled `collusion`.

**Done when** pytest and ruff pass. Commit as `T02: inventory policy, bullwhip, game theory`.
