# T03: Statistics and Monte Carlo

| | |
|---|---|
| Builder | **Gemini 4 Argon**, Pro account #1. Then a short Claude check (Sonnet 5.5, effort medium). |
| Start | Run `uv run scripts/argon.py pack T03`, then follow `prompts/argon/HOW-TO.md` → "Build a task" |
| Parallel with | T11, T12 (Argon) · T06 (Claude) |
| Time | ~3 h |
| Depends on | T01 and T02 committed (their code goes into the upload pack) |

---
You are implementing the statistics and the Monte Carlo for the Market Digital Twin.

**Read only these:**
- `SPEC.md` §4.6, §4.7
- `backend/engine/types.py`
- the public functions in `backend/engine/market.py` and `backend/engine/inventory.py` (if present)

**`backend/engine/stats.py`:**
- `ci95(x) -> (mean, lo, hi)`, using the t distribution.
- `paired_alpha_test(pi_ai, pi_base) -> dict(n, delta_mean, ci95, cohens_d, t, p_value)`, using `scipy.stats.ttest_rel(alternative="greater")`.
- `switching_chi2(choices_pre (T1, N), choices_post (T2, N)) -> dict(chi2, p, table)`
  - A "switch" means a consumer's choice differs from their previous tick.
  - Build a 2×2 table: window (pre, post) × (switched, stayed).
  - Run `scipy.stats.chi2_contingency`.

**`backend/engine/montecarlo.py`:**
- `Schedule` dataclass. Per tick it holds:
  - U1 decisions for A and B
  - U2 decisions (A = baseline, B = U1's B replayed)
  - ω for each firm
  - the shock timeline
  - crowd μ and σ (12, 2)

  It needs `to_dict()` / `from_dict()`, because the Serverless Job (T09) receives it as JSON.
- `run_paths(schedule, params, archetypes, n_paths, seed) -> dict`
  - Returns `pi_ai (n,)`, `pi_base (n,)`, and `fan` (p5/p25/p50/p75/p95 of A's cumulative profit per tick, for each universe).
  - **Common random numbers:** path r uses `np.random.default_rng([seed, r])` for both universes.
  - Randomness per path follows SPEC §4.7.
  - **Vectorise across paths.** Work at archetype level: use each archetype's mean α and mean sentiment, then draw multinomial counts per archetype. Reuse `market.costs`, `clear_market` and `update_goodwill`, which broadcast over `(n_paths, 2)`.
  - A Python loop over ticks is fine; a loop over paths is not.
- `preview(schedule_so_far, last_decision, horizon, n=100, seed)`: holds the last decision constant for future ticks. Used at every decision epoch.
- CLI: `python -m backend.engine.montecarlo --schedule in.json --n 10000 --seed 7 --out out.json`. The output includes `stats.paired_alpha_test` and `fan`.

**Performance:** n=100 paths × 60 ticks in under 150 ms locally, and n=10,000 in under 30 s.

**Tests in `tests/test_stats_mc.py`:**
- CI on a known normal sample.
- The paired test detects a +5 shift at n=200.
- χ² detects an injected switching jump.
- MC is deterministic for a given seed.
- With common random numbers, identical policies give Δ = 0 exactly.
- The performance targets above.

**Done when** pytest and ruff pass. Commit as `T03: stats + vectorised Monte Carlo`.
