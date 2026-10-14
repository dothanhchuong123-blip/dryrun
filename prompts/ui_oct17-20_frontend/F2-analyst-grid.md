# F2: Screens 3–4, the analyst log and the plans × shocks grid

| | |
|---|---|
| Builder | **Gemini 4 Argon**, Pro account #2. Then a Claude check (Sonnet 5.5, effort medium). |
| Start | `uv run scripts/argon.py pack F2`, then follow `prompts/argon/HOW-TO.md` → "Build a task". Upload screenshots of D7's analyst + grid screen, mid-run and finished. |
| Parallel with | F1, F3 (Argon) · P4 (Claude) |
| Time | ~3 h |
| Depends on | F0 committed |
| Target date | Oct 18–19 |

---
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
