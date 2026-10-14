# D7: Pivot mockup ("Test your plans", screens 1–6)

| | |
|---|---|
| Builder | **Gemini 4 Argon**, Pro account #2. Use Task mode if you can, so it can preview the page. |
| Start | `uv run scripts/argon.py pack D7`, then follow `prompts/argon/HOW-TO.md` → "Build a task". Also upload a screenshot of `docs/PIVOT-PLAN.html` and one of D6 mid-run. |
| Parallel with | P1 (Claude) · P2 (Argon #1). No shared files. |
| Time | ~2 h |
| After | `uv run scripts/argon.py import D7`, then open `docs/mockups/D7-pivot.html`, click through all six steps and check the last line is `<!-- END D7 -->`. **You approve it** before F0 starts; it is the visual reference for F0–F3. |

---
You are a senior product designer who also writes front-end code. Build the mockup for the new version of the app: a small-business owner describes their business, sees the news that hits it, watches an AI analyst (NVIDIA Nemotron) test plans in a simulator, compares plans × shocks in a grid, replays one plan, and takes away a decision memo.

**Read these first, in this order:**
1. `docs/DESIGN.md` **§12**, the brief for this job, then §11 for the visual system (tokens, fonts, light only, text budget, banned list) and §8, the anti-checklist.
2. `docs/PIVOT-PLAN.html`: the wireframes, plus what each screen borrows from its Mobbin references. Lift the layout ideas; make it look finished and hand-made.
3. `docs/EVENTS.md` v2: the shape of the data every screen shows.
4. `docs/mockups/D6-final.html`: the previous design. **Reuse its pixel arena code** (sprites, shoppers, store fronts, caption bar) for screen 5. Don't reuse its layout.

**Only create:** `docs/mockups/D7-pivot.html`, one self-contained file under DESIGN.md §9's rules (Tailwind CDN or plain CSS, Google Fonts, no images, no other network requests). Ignore the BUILD instructions about tests: there are none for this job.

**What it must do:**
- **All six screens** of DESIGN.md §12.1, reachable through the step bar and the primary buttons. Screens 3 and 4 share one screen; screen 5 is a drawer or overlay over the grid.
- **A scripted demo for the `coffee_hcmc` example** (Saigon Roasters vs Highland Supply, robusta beans +31%):
  - Clicking the example chip fills the text box and the parsed fields, with 2 fields tagged "guessed".
  - The news screen shows 3 cards.
  - On the analyst screen, the log streams ~12 rows over ~25 s while the grid fills in cell by cell: 6 plans × 4 shocks, using the example numbers in `docs/PIVOT-PLAN.html`.
  - "Best today" and "Safest" badges appear at the end.
  - The memo appears last.
- **Clicking any grid cell** opens the replay: the arena plays 24 weeks in ~20 s, the single profit chart (plan vs dashed "Do nothing", with a band) moves with it, and the captions come from markers (week 2 costs start rising, week 3 price +3%, week 4 extra stock arrives, week 7 Highland sells out).
- **"+ Add your own plan"** opens the 4 sliders. On submit, a new row appears with plausible numbers.
- **"Show full Nemotron thinking ▾"** expands 6–8 lines of plausible raw reasoning for a round.
- **Model chips with their jobs, and the credibility chip**, per DESIGN.md §12.2.
- **Fits 1440×900 and 1280×800 with no page scroll** on the analyst + grid screen. The other screens may scroll if they must. Usable at 390 px wide: the grid scrolls sideways inside its own box and the log stacks above it.

**Quality bar:**
- **Few words.** Follow §12.3 and §11's text budget. Count the words in each analyst row (≤ 20).
- **Numbers carry the story:** signed, tabular, and consistent between the grid, the memo and the replay's end value.
- **It must look like a product a small-business owner would trust.** Not a trading terminal and not an AI demo: no glows, gradients or sparkle icons.

**The file must be complete.** Budget ≤ 1,400 lines; keep the mock data in one `DATA` object. **The very last line must be `<!-- END D7 -->`.**

**Before the code**, write up to 6 lines on the layout of the analyst + grid screen in pixel sizes. **In Notes**, list: anything in §12 you couldn't follow and why, what you'd change with another hour, and the word count of the longest analyst row.
