# Argon's wave 3 review: what we checked and what we're doing about it

**Date:** 2026-10-15. **Input:** Argon's answers to `docs/wrapups/wave3-pivot-for-argon.md`. **Checked by:** Claude (Opus), against the code and with local engine experiments. No LLM or Tavily calls were made.

Verdicts: ✅ confirmed · 🟡 right direction, wrong cause or detail · ❌ wrong · ⏸ not adopted (for now).

## A. Model realism

### What the experiments show (coffee_hcmc, 1,000 paths)

**The real cause:** the calibration makes demand too insensitive in two ways.
1. **The owner's price isn't optimal in the model.** Own-price elasticity is −2.0 for coffee, but a 41% margin is profit-maximising only at −2.44 (Lerner: |E| = P / (P − c)). The model's best price is 5% above today's, so "Raise 5%" wins even with **no shock**: +$0.4k, on 100% of paths. For pc_parts it's worse: needs −4.67, has −1.92, and the model's best price is +19.5%.
2. **Almost nobody leaves the market.** Only 2% of shoppers choose "don't buy" (β̄ = 2 makes both shops far more attractive than the outside option). Market elasticity when both firms raise prices together is −0.18, so passing a 30% cost rise to customers costs almost no volume. That is why cost-plus wins by +$8.0k.

**A tested fix**, done by monkeypatching in a scratch script, without touching the repo:
- scale α per business so the owner's **current price is profit-maximising at today's costs** (Lerner). This is the same "the owner is about right today" assumption we already make for marketing (Dorfman–Steiner);
- lower β̄ so **15% of shoppers sit in "don't buy"**, which gives a market elasticity of ≈ −0.7.

| coffee, mean vs do nothing (bad case, % of runs better) | news | shipping | no shock |
|---|---|---|---|
| Raise 5% now, **before** | +$3.0k (+2.7, 100%) | +$0.6k (100%) | +$0.4k (100%) |
| Raise 5% now, **after** | +$2.4k (+2.0, 100%) | +$0.0k (−0.3, 37%) | −$0.2k (−0.4, 7%) |
| Textbook price rule, **before** | **+$8.0k** | +$0.2k | 0 |
| Textbook price rule, **after** | +$4.5k (+3.6, 100%) | 0 (85%) | 0 |
| Stock 4 + raise 10% wk 5, **after** | **+$5.8k** (+5.1, 100%) | −$0.6k (1%) | −$1.0k (0%) |

After the fix:
- **best today** = the staged stock + price plan;
- **safest** = the textbook rule. It adapts automatically, so it's never far wrong.

That's an honest story the demo can tell: *"the boring rule is the safe floor; the analyst's plan earns more if today's news holds."*

**Price-sensitivity uncertainty matters a lot.** Re-running with α × 0.7 and × 1.4:
- "Raise 15% in week 3" in the mild future swings from +$4.1k to −$0.9k;
- "Stock 4 + raise 10%" in the mild future swings from +$4.1k to +$1.5k.

This is the real risk an owner faces ("will my cafés accept it?"). A per-path α draw is the honest way to widen the bad case.

**Watch-outs:**
- pc_parts needs α × 2.1. Its no-shock "Raise 15%" loses $39k, which is plausible for a price-shopped GPU store.
- In furniture_eu every price plan loses and the textbook rule is ≈ 0. Its news shock barely moves the baseline (322.6k vs 323.4k). Check that the Red Sea fallback shock is meant to be that small.

### Argon's points one by one
| # | Claim | Verdict | Notes |
|---|---|---|---|
| 1a | "Raise 5%" wins everywhere because demand is too inelastic | 🟡 | The direction is right. The cause is the Lerner gap plus a 2% outside share, not `_P_REF = 105`. The fix is to calibrate α per business, not to "scale α up" by a guess. |
| 1b | `shipping` baseline > `mild` because the rival stocks out and spills buyers to you | ❌ | `shipping` is input +5%; `mild` is input +17.5% (0.5 × 35%). Shipping ≈ no-shock baseline (27.2k vs 27.1k). Nothing is wrong. |
| 1c | The textbook rule passes WAC through without the ±20% cap | 🟡 | True, and by design: it's a cost rule. It wins because the market barely shrinks (point 2 above), not because there's no cap. |
| 2 | The rival passes cost through "immediately"; add a U(2, 5)-week lag | 🟡⏸ | Not immediate: the rival prices on **weighted-average cost**, which already lags by its U(1, 4) weeks of stock. After recalibration, staged plans already win. Revisit only if A4 calibration review says so. |
| 3a | CRN cancels shared noise, so p5 is rarely negative | ✅ | Intended (CRN measures the plan's effect), but it leaves out parameter uncertainty. |
| 3b | Per-path α multiplier ~ Lognormal(0, 0.25) | ✅ | Adopted. Experiments show it's the dominant real risk. |
| 3c | Widen the shock scale to U(0.6, 1.4) | ⏸ | Ultra's 2–6 futures already cover "how big". Widening both double-counts. Keep U(0.8, 1.2). |
| 4 | Keep the textbook row only after the fix | ✅ | Adopted. It becomes the "safe floor" reference row. |

## B. Analyst and futures step (P3)
| # | Claim | Verdict | Action |
|---|---|---|---|
| 5 | Playbooks in `_ANALYST_SYSTEM`: staged timing, cash-limited partial hedge + supplier, bridge-driven repair | ✅ | Add to P3, phrased as ideas to try rather than rules |
| 6 | Futures to cover: cost up + demand down; rival undercut; delay longer than lead time; false alarm (cost ≈ 0 or falls back) | ✅ | Add to `_SCENARIO_SYSTEM`. "False alarm" is the best of these: it's the case that punishes over-stocking. |
| 7.1 | `_pct` fields given as fractions (0.15 instead of 15) → × 100 | ✅ | `rival_price_change_pct` and `share_shift_pct` are percentages (`schemas.py:208–209`); `delta_c_raw` and `demand_shock` are fractions. Rule: 0 < \|v\| < 1 on a `_pct` field → × 100, logged. |
| 7.2 | Ultra may send the *cost* change (0.26) instead of the *input* change (0.31) | 🟡 | Real risk, but auto-"restoring" is guesswork. Instead: the prompt shows both numbers with names ("input price +31%; your cost +26% — use the input number"), and a test checks the prompt text. |
| 7.3 | Force a milder-than-news case; insert `mild` if missing | ✅ | Adopted (SPEC already asks for one; code now enforces it). |
| 7.4 | Drop market `source_ids` (m…) on a cost-only case | ✅ | Drop the id rather than the case. |

## C. Creative ideas
| # | Idea | Verdict | Where |
|---|---|---|---|
| 8.1 | **Gut-check duel:** the owner picks a gut reaction, which becomes a "Yours" row Ultra must beat | ✅ | Strong video hook. Needs P4 to accept a gut plan at the start (it already has `add_user_plan`) and F1 to add 3 buttons. Added to P4 and F1. |
| 8.2 | **Skill vs luck bar** (steady-rival gain vs "extra if rival runs short") | ✅ | Already in the data. A two-tone bar in the F2 tooltip and the F3 memo. |
| 8.3 | **Cash slider** above the grid: client-side `over_cash` + labels | ✅ | Cheap and visual. F2. The labels must be recomputed with the same rule as `planner._labels`. F0's store gets a pure `labels(cells, shocks, cash)` helper with a test against fixture output. |
| 9 | Memo headlines | 🟡 | The style is right (week-1 action + $ + cash). The numbers are stale (pre-recalibration) and the "35%" is the input rise, not the cost rise. Re-draft after P2b. |
| 10a | Filter non-article URLs before extract | ✅ | Already in P3 ("drop non-article URLs"). Now the regex and the >80-char snippet rule are spelled out. |
| 10b | "Supply lens / Local market lens" header on screen 2 | ✅ | F1, as two labelled groups. |
| 10c | "Recheck when" → a one-click live news check | ✅ | F3 (`/news-check` exists in EVENTS v2). |

## C2. UI / UX
| # | Claim | Verdict | Notes |
|---|---|---|---|
| 12 | Screen 1 lacks a one-line pitch; "(soon)" chips look unfinished; pre-load coffee in replay mode | ✅ | All 3 examples exist, so enable all 3 chips. F1. |
| 13 | 2-line cells; tinted news column; 3-tier tooltip (header · P&L bars · rival/cash) | ✅ | F2 |
| 14 | What goes where for the v3.1 items | ✅ | Matches DESIGN §12.3a; the memo order is pinned in F3 |
| 15 | Replay: two-colour stock bar (old-cost vs new-cost stock) + cost/margin on shop cards | ✅ | It's the one change that *explains* stock-up. F3. Needs per-firm "stock bought before the shock" from `simulate_detail`, so it's added to P2b. |
| 16 | Collapsible round cards; auto-open thinking while it streams | ✅ | F2 |
| 17 | Week-by-week action checklist; waterfall + rival bar under the KPIs; "Why not the runner-up?" | ✅ | F3. The runner-up line is code-built from the grid, not LLM numbers. |
| 18.1 | Speech bubble covers "25 buy from Highland" | ✅ | Seen in `5-replay-*.png`. (The cited line `D7-pivot.html:554` is wrong; it's in the bubble placement code.) |
| 18.2 | Top log row clipped under the checklist | ✅ | Seen in `3-analyst-grid-*.png` |
| 18.3 | Dark-mode cells low contrast | 🟡 | Mild in the screenshot. Add the 1 px borders anyway (cheap). |
| 18.4 | Phone grid: sticky first column, tap → tooltip sheet | 🟡 | Sound advice, but not observed. Our "phone" screenshot actually shows screen 1 (the mockup reset when the viewport changed). Keep it as a requirement. |
| 18.5 | Use the real coffee numbers in the mock | ✅ | F0 must generate its mock stream from planner output after P2b, not hand-typed numbers |

## D. Risks
✅ Agreed: **the biggest risk is recording example replays or the video on the old calibration.** Hence P2b goes **before** P3's live run and P4's recordings. SSE through the Serverless Endpoint stays a T09 time-box (3 h, then the fallback in SPEC §3.1).

## Plan changes (applied to `prompts/`)
1. **New P2b** (Opus, ~3 h, Oct 16–17, before P3's live run): `prompts/3b_oct17_one-task/P2b-engine-recalibration.md`. It changes SPEC §15.3 and §15.5.2, which are shared contracts and need your OK.
2. **P3** gains the prompt playbooks, the futures checklist, 4 validators and the URL filter regex.
3. **P4** gains the gut-check plan input.
4. **F0–F3** gain the UI items above.
5. **The board** shows P2b and the new order.
