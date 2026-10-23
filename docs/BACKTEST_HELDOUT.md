# Held-out backtests (2026-10-22)

The 4 `bt_*` cases stay frozen as the public scorecard (B1 freeze rule). Six new `ho_*` cases were added only to
test general fixes. They're never listed in the app (`list_cases` reads `bt_*` only). Fixes are chosen on `ho_*` and the
`bt_*` cases are reported once, after that, as the final test.

| Case | Business | As of | Input (Pink Sheet) | Next 24 weeks |
|---|---|---|---|---|
| `ho_arabica_2021` | Portland coffee shop | 2021-12-15 | Arabica | flat (+4% peak, −1% end) |
| `ho_palm_2022` | Selangor crisp maker | 2022-04-15 | Palm oil | **fell −46%** |
| `ho_sunflower_2022` | Leeds fish and chips | 2022-01-15 | Sunflower oil | spike +66%, then +26% |
| `ho_rice_2023` | HCMC cơm tấm | 2023-04-15 | Rice, Viet Nam 5% | rose +32% |
| `ho_wheat_2025` | Ohio bakery | 2025-05-15 | Wheat, US HRW | flat (−1%) |
| `ho_cocoa_2025` | Brussels praline shop | 2025-09-15 | Cocoa | **fell −50%** |

Each case was recorded once, live: `uv run python -m backend.sim.cli --backtest <id> --record`. The six cost $0.22 of
Token Factory and 22 Tavily credits.

Evaluator: `uv run python scripts/heldout_eval.py [--frozen]`. It replays each recording's plans, shoppers and
futures, applies a fix, re-picks "Best today", and scores the pick on the real cost path in two ways:
- **app**: with the shoppers' sentiment, which is how the app grades itself;
- **neutral**: with no shoppers, the calibrated engine alone. This is the fixed yardstick.

## Findings

1. **The app's dollar claims are mostly shopper sentiment.** The held-out picks claim +$7k to +$41k against Do nothing.
   On the neutral yardstick the same picks come out between −$1.3k and +$0.6k. Every held-out pick includes a price
   rise, including both cases where the input price halved. The backtest score uses the same sentiment, so it
   grades itself with the same numbers.
2. **Lightning scores loyalty, not the reaction.** For a 5% price rise, every A-loyal group got `mu_a` > 0 and
   `mu_b` = −1 next to bubbles like "I can't afford that". See `docs/FEEDBACK_LOG.md`.
3. **The futures are one-sided.** The lowest future sits near −5% in 9 of 10 cases. The real peak fell inside the
   futures in 3 of 10 cases. Both real falls (−46% and −50%) were missed, and so were 4 of the 6 rises.
4. **Super read history as news.** "By December 2023, wheat prices had dropped 44.5 percent", read in May 2025,
   became the −44% headline future.

## Fixes tested (neutral regret: held-out total / frozen total)

| Fix | Held-out | Frozen | Verdict |
|---|---|---|---|
| As recorded | $3.9k | $23.3k | baseline |
| Rival side off (`mu_b` = 0) | $3.4k | $25.0k | not shipped: mixed on held-out, worse on frozen |
| Plan-relative (rival off + sign guard) | $8.4k | $28.2k | rejected |
| Mirror fall future | $3.9k | $23.3k | no pick changed: decisions don't follow the cost futures |
| Stale-quote news rule (`asof.stale_quote`) | $3.9k | $23.3k | **shipped**: fixes finding 4, no pick changed |

"Rival side off" was the only fix that looked better on held-out data, and it got worse on the frozen set. The
held-out set did its job: it would have caught both shopper fixes as overfitting. The open question is how much the
shopper sentiment should weigh at all (finding 1). That is a design decision, not a tuning one.

## Engine-only number and sentiment weight (2026-10-22, later the same day)

- Every grid cell, the memo and the backtest score now carry `engine_only_delta_usd`: the same plan on the same
  random streams with every shopper reaction neutral. The UI shows it next to each gain ("sim alone").
- All 14 recordings were backfilled by `scripts/backfill_engine_only.py`. Every recorded cell was re-derived to within $1
  before its number was added, and nothing else in any line changed (checked against git HEAD).
- Frozen picks on the real path, with shoppers → engine alone: cocoa +$9.3k → +$3.4k · eggs +$8.7k → +$1.1k ·
  robusta +$2.1k → +$1.2k · tariff −$15.9k → −$13.5k.

**Sentiment weight sweep** (`scripts/heldout_eval.py --sweep`). The weight is `MarketParams.delta`, 0.8 today. The
rule was set before the sweep: take the largest weight at which shopper mood explains at most half of a pick's
claimed gain (the median over cases). No-shopper regret is reported but not used to choose, because it favours 0 by
construction.

| Weight | Held-out median mood share | Held-out claim vs engine | Held-out regret | Frozen median mood share | Frozen regret |
|---|---|---|---|---|---|
| 0.8 (today) | 99% | +$129.1k vs +$6.7k | $3.9k | 78% | $23.3k |
| 0.2 | 96% | +$36.6k vs +$7.5k | $3.4k | 38% | $21.1k |
| 0.1 | 92% | +$23.0k vs +$10.6k | $2.6k | 18% | $16.2k |
| **0.05** | 86% | +$17.3k vs +$12.2k | $1.7k | 10% | $16.2k |
| 0.01 | 57% | +$13.2k vs +$12.2k | $1.7k | 1% | $16.0k |
| 0 | 0% | +$12.4k vs +$12.4k | $1.8k | 0% | $0 (circular) |

Read strictly, the pre-set per-case rule is only met at **0**: held-out picks gain so little from the engine alone that
any mood dominates the ratio. **Proposed: 0.05.** At 0.05 mood is 30% of the held-out claims in total and 10% of the
median frozen claim. It ties the lowest held-out regret ($1.7k) and cuts frozen regret from $23.3k to $16.2k. The
shoppers still tip close calls instead of making the call. 0.05 departs from the strict rule; the owner decides.

**Applied 2026-10-22 (owner's OK): `SENTIMENT_WEIGHT = 0.05`.** New runs record `sentiment_weight` in the `analysis` event. The 14 existing recordings keep 0.8 and replay exactly until re-recorded.

## Re-recorded at 0.05 (2026-10-22, owner's OK)

Re-recorded once each, live, with `--record`. A run was kept only if every Ultra and Super call succeeded; shopper
dropouts (counted as neutral) were allowed, as in the old recordings. A failed run was rolled back byte-for-byte.
The frozen 4 had been looked at once while checking the 0.05 weight (sweep above), so their new verdicts are not a
blind test.

| Recording | Old pick (0.8) | New pick (0.05) | Headline: old → new (sim alone) | Cost |
|---|---|---|---|---|
| coffee_austin | Stock 2w now, price +3% wk 8 | Raise 3% now + 4wk stock | +$3.3k (+$2.0k) → +$3.1k (+$2.9k) | $0.037 |
| pc_parts | Price +3% now, marketing +15% | Raise 3% now, stock 1wk | +$21.7k (+$21.2k) → +$28.7k (+$28.2k) | $0.041 |
| bt_cocoa_2024 | Staged switch: stock 3wk, alt low | Stock 4w + price 3% wk10 | real path: rank 1/9, +$9.3k (+$3.4k) → **rank 2/9, +$1.8k (+$1.1k)**, regret $0 → $2.3k | $0.050 |
| bt_tariff_2025 | Staged: stock 4wk, price +2% wk8 | Stock up 4 weeks now | real path: rank 7/9, −$15.9k (−$13.5k) → rank 7/9, −$16.2k (−$16.2k), still loses to Do nothing | $0.036 |

Not re-recorded, still at 0.8 (they replay exactly and show "sim alone"):
- **furniture_eu**: 3 attempts, each hit an Ultra/Super failure (Super news-parser timeout, which dropped a real
  card; Ultra memo timeout ×2; Ultra round-1 invalid JSON ×2). In the one attempt that got past round 1, the memo
  claimed +$3.3k against −$0.2k for the sim alone, so even at 0.05 the shoppers decided that headline.
- **bt_robusta_2024**: 1 attempt, a Super news-parser timeout.
- coffee_hcmc, bt_eggs_2025 (not needed: same pick, small shift).

Spend: $0.164 kept + $0.168 rolled back = **$0.33** (telemetry estimate; Nebius billed ~9% above our estimate so far).

## Held-out set re-recorded at 0.05 and listed (2026-10-23, owner's OK)

The owner asked for more real cases in the app. The six `ho_*` cases were the only other recordings, and they were
still at 0.8, where shopper mood made almost every pick look like a big win. The rule was set before any re-record:
**re-record all six at 0.05 and list every one of them, whatever it scores.** Listing only the winners would be
cherry-picking. The app now lists all 10 cases (`list_cases` reads `bt_*` and `ho_*`), with a "Right in N of 10"
tally. These six are no longer held out: the 0.05 weight was chosen on them, so treat their verdicts as in-sample.

Same rules as above: `--record`, a run kept only if every Ultra and Super call succeeded, shopper dropouts allowed.

| Case | Old pick (0.8): real path | New pick (0.05) | Real path vs Do nothing (sim alone) | Rank | Regret | Verdict |
|---|---|---|---|---|---|---|
| ho_arabica_2021 | Stock 1wk then raise 4% wk4: +$13.3k | 3% rise wk4 + 10% marketing | −$0.3k (−$0.4k) | 4/9 | $0.7k | Missed |
| ho_cocoa_2025 | Stock 2w, raise 4% wk5: +$41.3k | Stock 2w, raise 2% at wk8 | +$1.7k (−$0.8k) | 1/9 | $0 | Right |
| ho_palm_2022 | Staged: 1wk stock then +2% price: +$12.8k | Price +2% now | −$54 (−$133) | 3/9 | $225 | Missed |
| ho_rice_2023 | Price +2% from week 3: +$7.6k | Price +3% wk2, marketing +5% now | −$99 (−$19) | 3/8 | $99 | Missed |
| ho_wheat_2025 | Raise 3% + marketing 20%: +$36.7k | Stock 2w then raise 2% | +$3.1k (+$0.5k) | 1/9 | $0.4k | Right |
| ho_sunflower_2022 | Raise price 5% now: +$21.0k | **not re-recorded** (3 tries) | +$21.0k at 0.8 (−$0.6k) | 3/9 | $23.9k | Right at 0.8 only |

- At 0.05 the claims shrink from +$7–41k to between −$0.3k and +$3.1k, much closer to the engine alone, as intended.
- Three of the five re-recorded picks miss, but by $54 to $314: in those cases nothing in the plan list moved the
  result much. ho_cocoa_2025 is a "Right" that rests on the shoppers: the engine alone has the pick at −$0.8k.
- ho_sunflower_2022: three attempts, each with one Ultra/Super fallback (Ultra "did not answer twice" in a later round
  or an invalid answer). It stays at 0.8 and its "Right" is the inflated kind this section is about. Open: retry,
  record with `--allow-fallback`, or show it with a note.
- Each miss has a `hindsight` line in its case file (EVENTS v2.4), shown under the row.
- Stale `cell_backtest_*_realized.jsonl` files from superseded picks were removed (the offline demo took the first
  match by name, so bt_cocoa_2024 and bt_tariff_2025 could replay the old pick's real path).

Spend: 11 live runs, 5 kept, **$0.71** Token Factory (telemetry
estimate), 0 Tavily credits (all cached).

## "Do nothing" can be the pick (2026-10-23, owner's OK)

Found while reading the misses: `best_today` only ever chose among the active plans. In ho_rice_2023 the app's own
forecast for its pick was −$59 (the only plan above 0, +$19, needed $7.4k of cash the owner didn't have), and it
recommended it anyway. The rule, set from the app's own numbers and applied to every recording, not chosen by
outcome: **when no affordable plan beats doing nothing on average in the news column, `best_today` and the memo's
pick are "Do nothing"** (SPEC §15.5.2). A "Do nothing" pick is scored `right` when no tested plan beat doing nothing
on the real path (it ranks first); otherwise it missed.

`scripts/rescore_do_nothing.py --write` applied it to the recordings from their own numbers, no model calls:
- **ho_rice_2023**: pick "Price +3% wk2, marketing +5% now" (−$99 on the real path, rank 3/8) → "Do nothing" ($0,
  rank 1/8, regret $0): **Missed → Right**. Its memo words are now the engine's template ("Hold steady: no plan beat
  doing nothing"), since the recorded Ultra memo argued for the old pick.
- analysis_furniture_eu, ho_palm_2022: only an early-round "Best today" badge changes; their picks stand.
- ho_palm_2022 stays a miss: its pick forecast +$6, above 0.

Ledger after this: **Right in 7 of 10** (sunflower still at 0.8, so 6 of the 9 re-recorded or 0.05 cases).
