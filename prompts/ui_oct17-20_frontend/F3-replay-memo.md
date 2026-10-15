# F3: Screens 5–6, replaying one plan and the decision memo

| | |
|---|---|
| Builder | **Claude Code**: **Sonnet 5.5**, effort medium |
| Start | New Claude Code session in this folder → pick that model → type: `Do the task in prompts/ui_oct17-20_frontend/F3-replay-memo.md` |
| Parallel with | F1, F2 (Claude, separate sessions) · P3/P4 |
| Time | ~3 h |
| Depends on | F0 committed |
| Target date | Oct 18–20 |

---
The visual reference is `docs/mockups/D7-pivot.html`: open it in the built-in browser to look at it. Copy its layout and look, but **not its numbers**. Its numbers are older than v3.1 and some are wrong, so use the coffee_hcmc example instead. Check your screens in the built-in browser (`npm run dev`) at 1440, 1280 and 390 px before you commit.

You are building the replay view, which reuses the pixel arena, and the decision memo.

**Read these first:** `docs/DESIGN.md` §12.1 rows 5–6, §12.3, §11 (arena rules) and §7; `docs/mockups/D7-pivot.html`'s replay and memo screens; `docs/EVENTS.md` v2 (the replay stream, `memo`, `/memo`); F0's store, events and format modules; and the existing `components/Arena.tsx`, `components/arena/*` and `components/terminal/*`.

**Only create or change** files in `frontend/components/replay/`, `frontend/components/memo/`, `frontend/components/Arena.tsx`, `frontend/components/arena/*` and `frontend/components/terminal/*`. The slots `ReplayDrawer.tsx` and `MemoScreen.tsx` keep their names and props.

**`ReplayDrawer`** (opens over the analyst screen when `replay.open`):
- **Header:** "{plan} · {shock label}", a week counter ("Week 9 of 24"), play/pause, step buttons and speed (1×, 2×). Close with ✕ or `Esc`.
- **The arena** (adapt `Arena.tsx` to read the replay ticks instead of v1 run ticks).
  - Store A is the user's business, labelled with `profile.business_name`; store B is labelled with `rival_name`.
  - Captions come from `marker.text`, and the sold-out, price-tag and truck behaviour come from markers and ticks.
  - **Keep all of §11's arena rules:** sprites at 3×, waypoints, and positions in refs, never React state.
- **One chart under it** (adapt `ProfitChart`): cumulative gross profit over weeks.
  - Plan = solid indigo; do nothing = dashed grey.
  - End-of-line labels with the dollar values, and a bracket showing the difference.
  - Marker pins on the x-axis, and a playhead.
  - The title states the finding: "Your plan pulls ahead from week 7 (+$7.4k)".
- **"Analyst view" tab** inside the drawer: the existing price/cost, stock and bullwhip charts from `components/terminal/`, fed by the replay ticks. Hide the Nash matrix unless `nash` data exists.
- At the end of the replay, freeze on week 24 and show the U1 vs U2 totals from `replay_done`.

**`MemoScreen`:**
- **The recommendation** as the headline (Newsreader).
- **Three numbers:**
  - "+$7.4k vs doing nothing (6 months)"
  - "Bad case (1 in 20): +$3.0k"
  - "1,000 runs", which becomes "10,000 runs · verified on Nebius" when `numbers.verified`.
- **Sections:** "Why", "Watch out for", "Recheck when", each ≤ 2 sentences as given.
- **"The plan in detail":** the `PlanSpec` in plain words ("Buy 4 extra weeks of beans this week · raise price 3% from week 3").
- **"Sources":** each headline linked, with its quote.
- **"How this was made":** one line plus model chips: "Nemotron Ultra proposed and compared N plans; every number comes from the simulator, not the AI."
- **Buttons:** "Copy" (clipboard, with a fallback), "Download .md" (`downloadMemo`), "Watch this plan play out" (`openReplay` for the memo's plan in the `news` column), "Try another business" (back to step 1).
- **If `fallback_used`:** a muted note, "Nemotron was unavailable, so this memo used the built-in rules."

**Quality bar:** the arena stays ≥ 50% of the drawer's height on desktop; 60 FPS with 200 shoppers. At 390 px, the drawer is full-screen and the chart sits under the arena.

**Done when** `npm run build` passes, any mock cell replays with captions and the chart in sync, and the memo renders all its parts from the mock. Commit as `F3: replay drawer and decision memo`.

## v3.1 realism update (2026-10-15)

DESIGN.md §12.3a and EVENTS v2.1 win over anything above that conflicts.

- Replay scene: small mono labels on the shop nodes from each tick's `unit_cost`, `cover_weeks` and `in_transit`. Keep the shoppers. Markers `rival_price` and `new_player` get captions and pins. (The cash chart toggle is P1: build it last, only if there's time.)
- Memo:
  - the `cost_line` under the headline;
  - a small 5-bar waterfall of `numbers.bridge` + total;
  - the rival split line;
  - the cash line when `peak_cash_usd > 0` ("Needs about $Z up front · pays back by week W", or "Over the $C you said you have");
  - a closing **"Not in these numbers"** box with `not_modelled.fixed` and `not_modelled.found` (with source links).
  - All of these go into `memo_markdown` too, which is P4's job; here they only need to render.

## Review additions (2026-10-15, `docs/wrapups/wave3-argon-verdict.md` §C, §C2)
- **Replay, the one change that explains stock-up:** each shop's stock bar is split in two colours: stock bought at the old cost vs at the new cost (`old_cost_share` from P2b). Under it: "Cost $6.50 · margin $4.50" from `unit_cost`, which updates weekly. The viewer sees your cheap stock earning a margin while the rival's has already gone up.
- **Speech bubbles** never cover the dot-group labels (D7 bug: "Saigon never ran out" over "25 buy from Highland"). Place them above or below the dot groups, max 2.
- **Memo order:**
  1. headline;
  2. the week-by-week **actions** strip (P3's `actions`);
  3. the 3 numbers;
  4. the P&L waterfall and the skill vs luck bar;
  5. the cash line;
  6. Why;
  7. **"Why not {runner-up}?"** (P3's `runner_up`);
  8. Watch out for;
  9. Recheck when;
  10. Sources;
  11. "Not in these numbers".
- **"Recheck when"** carries a "Check the news now" button that calls `/api/analyses/{id}/news-check` (1 Tavily credit, capped) and shows the result inline.
