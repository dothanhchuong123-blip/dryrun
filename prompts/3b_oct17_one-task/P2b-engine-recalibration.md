# P2b: Engine recalibration (price sensitivity, outside option, uncertainty)

| | |
|---|---|
| Builder | **Claude Code**: **Opus 5.5**, effort high |
| Start | New Claude Code session in this folder → pick that model → type: `Do the task in prompts/3b_oct17_one-task/P2b-engine-recalibration.md` |
| Parallel with | P3's offline part (it only uses the planner's public API, which doesn't change). F0–F3. |
| Must finish before | **P3's live run, P4's example recordings, and any F0 mock data taken from the planner** |
| Time | ~3 h |
| Depends on | P2 committed |
| Target date | Oct 16–17 |
| Live spend | none |
| Contract change | SPEC §15.3 and §15.5.2. **Approved by the user on 2026-10-15.** |

---
**Why:** an Argon review plus local experiments showed that the calibrated market is too insensitive to price. The evidence is in `docs/wrapups/wave3-argon-verdict.md` §A.
- Own-price elasticity is about −2.0, but the owner's margin implies −2.44 (coffee) or −4.67 (pc_parts). So "Raise 5% now" wins even with **no shock**.
- Only 2% of shoppers choose "don't buy", so passing a cost rise to customers is almost free and the textbook cost-plus rule beats every plan by a wide margin.

**Read only these:**
- `docs/wrapups/wave3-argon-verdict.md` §A
- `SPEC.md` §4.1, §15.3, §15.5.2
- `backend/engine/planner.py`: `calibrate`, `_choice_probs`, `_streams`, `_simulate`, `simulate_detail`
- `tests/test_planner.py`
- `backend/engine/market.py`: `make_archetypes` (read only)

**Only change:** `backend/engine/planner.py`, `tests/test_planner.py`, and SPEC §15.3 / §15.5.2 / §15.9 (text for what you change). Don't touch `market.py`, `montecarlo.py` or `types.py`.

## 1. Calibration (`calibrate`)
Two assumptions, stated in the docstring and in SPEC §15.3:
- **"Your price is about right today."** Scale every archetype's α by one factor `s` so that, at the starting prices with neutral sentiment and no shock, the owner's price is profit-maximising given the rival's price. That's the Lerner condition: own elasticity E_d = −P / (P − c_raw0). This is the same idea as the marketing calibration already in `calibrate` (Dorfman–Steiner). Clamp `s` to [0.5, 4] and record it.
- **"Some shoppers can walk away."** Set the outside option so that **15% of shoppers choose "don't buy"** at the start (`_OUTSIDE_SHARE = 0.15`). Do it by shifting both firms' β̄ by the same amount, which keeps the rival's relative position.

Solve both together with a small fixed-point loop, alongside the existing γ/marketing loop. A scratch version converged in under 40 iterations:
- multiply `s` by `(E_target/E)^0.7`;
- move β̄ by `0.8 × (logit(out) − logit(0.15))`.

Then compute `d0`, `k_q` and capacity as before. `Calibration` gains `alpha_scale` and `beta_bar` (as `params.beta_bar`) and `outside_share`.

The calibration test still holds: "Do nothing" with no shock matches weekly sales ±10% and gross profit ±15%.

## 2. Price-sensitivity uncertainty (`_streams`, `_simulate`)
- Per path, draw `alpha_mult ~ Lognormal(0, 0.25²)` from the same per-path RNG, **after** the existing draws so current streams don't shift.
- It multiplies α for every archetype on that path, so it's the same for every plan in the column (common random numbers).
- Keep the shock scale at U(0.8, 1.2): Ultra's futures already cover "how big".
- `evaluate_cell` must still equal the grid cell exactly, and chunking must still not change results.

## 3. Investigate two oddities, fix only if they're bugs
Repro: `furniture_eu`, "Do nothing", one path.
1. **Cost lag.** With `delta_c_raw = 0.12`, `onset_week = 2` and `ramp_weeks = 3`, A's `unit_cost` only starts rising in **week 16**. Lead time is 5 and stock is 2 weeks, so roughly week 9–11 is expected. Check the order pricing (an order is priced at its order week), the raw → finished-goods WAC, and the 4-week moving-average production plan. If the lag comes from a large finished-goods buffer, say so and size that buffer (it's `1 × d0` at the start).
2. **A cost shock that raises the do-nothing profit.** Cost-only shock: baseline profit $313.7k vs $313.0k with no shock. The mechanism is real: the rival passes cost through (+7% price) and A's sales rise about 11%. Re-check the size after §1. If a pure cost shock still *raises* the do-nothing profit for any of the 3 examples, report it in your reply with the numbers rather than forcing it.

## 4. Replay data for the two-colour stock bar (F3)
In `simulate_detail`, add per firm per week:
- `old_cost_share` `[A, B]`: the share of raw plus finished stock valued at the **pre-shock** unit cost (0–1);
- `spot_cost` `[A, B]`: today's purchase price per unit, USD.

Add both to SPEC §15.9's tick list and to EVENTS v2.1's `tick` row, **marked "(P2b)"**. That is an EVENTS change, so ask the user before editing EVENTS.md. If they say no, put the fields under `extra` in the tick and note it.

## 5. Acceptance (new tests, `coffee_hcmc` unless noted, 1,000 paths)
- After calibration, own elasticity at the start = −P / (P − c) ± 0.05, and the outside share = 0.15 ± 0.01, for all 3 examples.
- **No free lunch:** with a zero shock, "Raise 5% now" has `mean_delta_usd ≤ 0` (it may be slightly negative) for all 3 examples.
- **The cost-plus rule no longer dominates:** in the coffee `news` column, a staged plan (`extra_stock_weeks=4, price_change_pct=10, price_change_week=5`) has a higher mean than "Textbook price rule".
- **Real downside:** in the coffee `shipping` or no-shock column, at least one seed plan has `p5_delta_usd < 0`.
- Bridge identity, CRN, chunking and performance tests all still pass (8 × 6 grid < 6 s).

Print the coffee seed grid plus the textbook row (all 4 default futures and a no-shock column), before vs after, in your reply.

**Done when** pytest and ruff pass. Commit only your files as `P2b: recalibrate price sensitivity and outside option, alpha uncertainty`. Tick P2b on the board.
