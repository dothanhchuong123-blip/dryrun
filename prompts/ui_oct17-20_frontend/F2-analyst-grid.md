# F2: Screens 3–4, the analyst log and the plans × shocks grid

| | |
|---|---|
| Builder | **Claude Code**: **Sonnet 5.5**, effort medium |
| Start | New Claude Code session in this folder → pick that model → type: `Do the task in prompts/ui_oct17-20_frontend/F2-analyst-grid.md` |
| Parallel with | F1, F3 (Claude, separate sessions) · P3/P4 |
| Time | ~3 h |
| Depends on | F0 committed |
| Target date | Oct 18–19 |

---
The visual reference is `docs/mockups/D7-pivot.html`: open it in the built-in browser to look at it. Copy its layout and look, but **not its numbers**. Its numbers are older than v3.1 and some are wrong, so use the coffee_hcmc example instead. Check your screens in the built-in browser (`npm run dev`) at 1440, 1280 and 390 px before you commit.

You are building the heart of the pivot UI: the screen where judges watch Nemotron work and see which plan holds up.

**Read these first:** `docs/DESIGN.md` §12.1 row "3+4", §12.3, §11 and §5 (colour meaning); `docs/mockups/D7-pivot.html`'s analyst + grid screen (match it); `docs/EVENTS.md` v2 (`plan`, `crowd`, `grid_cell`, `grid_summary`, `agent_step`, `reasoning`, `shocks`, `memo`, `/plans`); and F0's store, events and format modules. Use only the store's actions.

**Only create or change** files in `frontend/components/analyst/` and `frontend/components/grid/`. The slots `AnalystLog.tsx` and `PlanGrid.tsx` keep their names and props.

**`AnalystLog`, the left column. It scrolls inside itself, never the page.**
- **Rows** from `agentSteps`, grouped by round ("Round 1 · Nemotron Ultra · thought for 9 s").
  - Each row has a type tag (Think / Test / Result / Shoppers / Fallback), its text, and number chips.
  - The newest row animates in calmly; respect `prefers-reduced-motion`.
- **"Show full Nemotron thinking ▾"** per round expands that round's `reasoning` text: monospace, max-height with internal scroll, and auto-follow while it streams.
- **Status at the bottom while running:** "Testing 'Stock up 4 wk + raise 3% wk 3' in 4 situations…"
- **Model chips:** "Ultra · analyst", "Lightning · shoppers".

**`PlanGrid`, the right column.**
- **Columns** = `shocks.cases`. The `news` column is highlighted and labelled "today's news".
- **Rows** = "Do nothing" first (showing `baseline_profit_usd` per column as "$84k gross profit"), then the plans in arrival order, each with a source tag (Seed / AI / Yours).
- **Each cell:**
  - `mean_delta_usd` big;
  - "bad case −$1.8k" small;
  - a diverging green/grey/red scale with the sign always shown;
  - a pending shimmer until it arrives;
  - a small "✓ 10,000 runs" mark when `source: "cloud"`.
- **Tooltip / tap:** "Average over 1,000 runs vs doing nothing. In 1 run out of 20 it's worse than −$1.8k. Better in 87% of runs."
- **Text badges:** "Best today" on `best_today`, "Safest" on `safest`. They update after each `grid_summary`.
- **Clicking a cell** calls `openReplay(plan, shock)`.
- **"+ Add your own plan"** opens a small panel with 4 controls:
  - price change −20…+20%;
  - from week 0…23;
  - extra stock 0…8 weeks;
  - switch supplier (on/off, then its cost change % and lead time).
  - Name it automatically ("Your plan: +4% wk 2, stock 3 wk").
  - Submit calls `addPlan`, and its cells appear like any other row. At most 4; explain the limit.
- **"Verify with 10,000 runs on Nebius"** calls `verify()`, shows `telemetry.job.status` in plain words, and is disabled while running.
- **When the `memo` arrives:** a sticky bar "Nemotron recommends: {plan} → See the memo", which goes to step "memo".
- **Shoppers:** hovering a plan row shows its two most telling `crowd` bubbles.

**Layout:** this screen must fit 1440×900 and 1280×800 with no page scroll. At 390 px, the log stacks above the grid and the grid scrolls sideways inside its own box with a sticky first column.

**Done when** `npm run build` passes and the full mock run fills the log and grid exactly as in D7, including adding a user plan. Commit as `F2: analyst log and plans grid`.

## v3.1 realism update (2026-10-15)

DESIGN.md §12.3a and EVENTS v2.1 win over anything above that conflicts.

- AnalystLog: a first group, **"Futures to test"**, from the `scenarios` thought and the `scenarios` reasoning.
- PlanGrid:
  - 2–6 columns from `shocks.cases`, each header with the label + a likelihood tag; `why` and the cost line go in the header tooltip. Below 1024 px the grid scrolls sideways inside its card.
  - **The cell tooltip is the P&L breakdown:** the five lines + total; the two rival lines ("With a rival who never runs out" / "Extra if {rival} runs short"); then "Cash tied up $Z · back by week W".
  - An "Over your cash" badge on `over_cash` cells.
  - In "+ Add your own plan", show upfront cash live (extra stock weeks × weekly sales × unit cost), with the badge when it's over `cash_available`.

## Review additions (2026-10-15, `docs/wrapups/wave3-argon-verdict.md` §C, §C2)
- **Cells:** 2 lines only: the big mean (tabular) and a muted "bad case …". A small "Over cash" corner tag only when it applies. The `news` column gets a light full-height tint.
- **Tooltip** (≈ 280 px; on phones a bottom sheet opened by tap, and a second tap opens the replay), in three tiers:
  1. plan · future · mean · "better in N% of runs" · bad case;
  2. the 5-line P&L breakdown as small diverging bars that add up to the total;
  3. the **skill vs luck bar**: a two-tone bar, solid indigo = "With a rival who never runs out" and hatched amber = "Extra if {rival} runs short". Then "Cash tied up $Z · back by week W".
- **Cash slider** in the grid header: "Cash you could put in: $8,000" (from `cash_available`; hidden when 0). Dragging it recomputes over-cash tags and the Best today / Safest badges client-side with `lib/labels.ts`. No backend call.
- **Analyst log:** collapsible round cards ("Futures to test", "Round 1", "Round 2", "Round 3"). A finished round collapses to a one-line takeaway built from its `result` steps. "Show full Nemotron thinking" opens automatically while that round's reasoning streams, and closes when the round's JSON arrives. Fix the D7 bug where the first row is clipped under the checklist (scroll padding).
- **Phone:** the first column (plan names) is sticky during horizontal scroll.
- **Dark mode:** 1 px semantic borders on green and red cells (they blend into the card in D7).
