# Wave 3 wrap-up: "Test your plans" pivot (P1 · P2 · D7). Brief for Gemini 4 Argon

**Date:** 2026-10-15 · **Project:** Market Digital Twin, Nebius x NVIDIA Global AI Hackathon (track: Best Apps and Agents; also aiming for Best Use of Tavily and Most Valuable Feedback) · **Submit by:** Oct 30 2026, 12:00 GMT+7 · **Live demo must stay up until Dec 15.**

You have no repo access. You are being asked for **advice and creative ideas only**. A Claude session will decide what to build.

**What's attached:**
- this brief;
- `UPLOAD_ME.md`: the source files, each under a "## `path`" heading. It contains CLAUDE.md, SPEC.md (§15 is the pivot), DESIGN.md (§12 is the screens), EVENTS.md, the agents' schemas and prompts, the planner engine and its tests, the example businesses, the feedback log, and the next task prompts (P3, P4, F0–F3);
- `D7-pivot.html` and `PIVOT-PLAN.html`: open these in a browser;
- `screens/*.png`: screenshots of the mockup.

---

## 1. The product in one paragraph

A small-business owner types a few sentences about their business (price, cost, weekly sales, supplier, rival). **Tavily** finds news that hits *their* inputs and *their* local market. **Nemotron Ultra** (via Nebius Token Factory) acts as an analyst: it proposes the futures worth testing and then the plans worth trying. A **deterministic NumPy engine** tests every plan against every future (a plans × futures grid, 1,000 Monte Carlo paths per cell, 10,000 on a Nebius Serverless Job) and scores each cell against **"Do nothing"**. The output is a **decision memo**. Ultra writes the words; the engine supplies every number. Rule: **LLMs make decisions, the engine computes outcomes.**

Tagline: **"News just hit my business. Which plan should I pick, and how bad could it get?"**

### Pipeline
1. Profile: Super (thinking off) parses plain text into a `BusinessProfile`, or the user picks one of 3 examples.
2. News: Tavily supply search (`topic: news`) plus local-market search (`topic: general`, `country` boost, can be in the local language). Super turns the top 3 supply headlines into shock numbers with verbatim quotes.
3. Futures (step 0b): Ultra (thinking on) proposes 2–5 extra grid columns plus a list of risks it *can't* model. The `news` column is always first. Max 6 columns.
4. Analyst rounds 1–3: Ultra proposes up to 3 plans per round (8 plans max, including 3 seed plans), reads the results table and revises. Each new plan gets a reaction from 12 shopper groups (Nemotron Lightning), which becomes the plan's demand sentiment.
5. Memo: Ultra writes `headline / why / watch_out / recheck_when`. Code inserts every number, the P&L breakdown, cash figures, sources and a "Not in these numbers" box.
6. Replay: click any cell to watch that plan play out week by week as a market scene, next to "Do nothing".

### Plan knobs (what Ultra can propose)
Price change ±20% from week X · one extra stock order of 0–8 weeks in week X · marketing −50…+100% · switch supplier (cost change, lead time, how much of the shock also hits them).

### Future knobs (what a grid column can be)
Input price change (−50%…+100%) · supplier lead time (−2…+10 weeks) · whole-market demand (±50%) · **rival price move (±20%)** · **share lost to a new player (0–30%)** · onset week and ramp. Each column also carries `likelihood` (likely/possible/unlikely), a one-line `why` and the news ids it's based on.

---

## 2. What wave 3 delivered (all committed, 109 tests passing)

| Task | Built by | What it is |
|---|---|---|
| **P1** schemas, prompts, examples | Claude Sonnet | Pydantic models `BusinessProfile`, `PlanSpecModel`, `AnalystStep`, `ScenarioSet`, `MemoDraft`; prompt builders for the profile parser, futures step, analyst rounds, memo and shopper reactions; 3 example businesses, live-checked against Token Factory |
| **P2** engine planner | Claude Opus | `backend/engine/planner.py` (≈1,100 lines, pure seeded NumPy): calibration from a profile, plan simulation, the grid, single-cell evaluation, week-by-week replay of one cell, and a JSON job CLI for the 10k-path Nebius Job |
| **D7** pivot mockup | Claude Opus (Argon's version was rejected) | 6 screens (your business → news → analyst log → grid → replay → memo), light and dark, Inter only. A generic "market scene" replay replaces the old pixel arena |
| **v3.1 realism update** | Claude Opus | Ultra picks the futures; news moves only the exposed share of cost; country-aware search; honest P&L per cell; "not modelled" list |

### The 3 example businesses
| id | Business | Story shock |
|---|---|---|
| `coffee_hcmc` | Coffee roaster in Ho Chi Minh City selling to cafés (**the demo video story**) | robusta price spike |
| `pc_parts` | Online PC-parts shop importing graphics cards | GPU tariff |
| `furniture_eu` | Vietnamese furniture maker shipping to Europe | Red Sea shipping disruption |

### What each grid cell reports (all USD over 24 weeks, vs "Do nothing" on the same random numbers)
- `mean_delta_usd`, `p5_delta_usd` (the "1-in-20 bad case"), `p_better` (share of paths where the plan wins)
- **P&L bridge:** cheaper stock + your price change + customers won/lost + marketing + holding. The five lines sum exactly to the mean (exact identity, tested; no "other" line).
- **Rival split:** the gain with a rival who never runs out, plus the "extra if the rival runs short" part.
- **Cash:** peak extra cash the plan ties up, payback week, and an "Over your cash" flag against the owner's stated cash.
- Labels: `best_today` (best mean in the news column, not over cash) and `safest` (best worst-case p5 across non-"unlikely" columns).

### Engine assumptions worth questioning
- 1 tick = 1 week, 24-week horizon, profit = **gross** profit (no rent or salaries).
- Shoppers: multinomial logit with 12 archetypes and an outside option. Calibrated so "Do nothing, no shock" reproduces the owner's weekly sales (±10%) and gross profit (±15%).
- Stock bought before a price rise keeps its old cost (weighted-average purchase cost). This is the core of most real plans.
- **The rival** has the same input cost, keeps its usual markup over its current cost, and follows your price if you sit >5% under it for 2 weeks (matching you at +2%). Its starting stock is unknown, so it's drawn U(1, 4) weeks per path.
- Per-path randomness: demand noise σ = 0.1, lead time ±1 week, shock size × U(0.8, 1.2).
- Performance: an 8 × 6 grid × 1,000 paths × both rival variants runs in under 6 s; one cell in under 0.5 s.

---

## 3. Real output: coffee roaster, default 4 futures, 3 seed plans

Profile: price $11/bag, unit cost $6.50, 280 bags/week, lead time 3 weeks, 2 weeks of stock, rival at $10.50, 85% of cost is beans, $8,000 cash. Headline shock: beans +35%, +1 week lead time, −10% demand.

"Do nothing" gross profit over 24 weeks: mild $25.2k · news $20.7k · severe $16.9k · shipping $27.2k. Grid computed in 0.52 s.

| Plan | Future | Mean vs do nothing | 1-in-20 bad case | Wins on | Cash tied up | Payback week | Bridge (cost / price / volume / holding) |
|---|---|---|---|---|---|---|---|
| Raise price 5% now | news | +$3.0k | +$2.7k | 100% | $0.4k | 4 | +0.3k / +3.6k / −1.0k / +0.1k |
| Raise price 5% now | shipping | +$0.6k | +$0.4k | 100% | $0.2k | 9 | 0 / +3.4k / −2.8k / 0 |
| Stock up 4 weeks now | news | +$2.0k | +$1.6k | 100% | **$7.3k** (of $8k) | 5 | +2.1k / 0 / 0 / −0.1k |
| Stock up 4 weeks now | severe | +$2.4k | +$1.2k | 100% | $7.3k | 4 | +2.6k / 0 / 0 / −0.2k |
| Stock up 4 weeks now | shipping | −$0.1k | −$0.3k | 20% | $7.4k | 18 | +0.2k / 0 / 0 / −0.3k |
| Textbook price rule (cost-plus) | news | **+$8.0k** | +$6.4k | 100% | $0.4k | 9 | +0.3k / +10.0k / −2.4k / 0 |
| Textbook price rule (cost-plus) | severe | **+$10.5k** | +$8.4k | 100% | $0.8k | 10 | +0.8k / +11.9k / −2.2k / 0 |

Engine labels: `best_today` = Textbook price rule, `safest` = Raise price 5% now.

**Things that look off to us (please weigh in):**
1. **"Raise price 5%" wins on 100% of paths in every future, even "shipping".** The shoppers may be too price-insensitive, or the rival (same cost, keeps its markup) makes price rises nearly free. An owner would ask, "So why haven't I raised prices already?"
2. **The dumb cost-plus rule beats every "smart" plan by a wide margin.** Because the rival also passes its cost through, passing cost on costs little volume. That may be realistic in a commodity shock, but it undercuts the story that an AI analyst adds value.
3. **`p_better` is 100% almost everywhere and the 1-in-20 case is rarely negative.** The risk side of "how bad could it get?" barely shows. The noise may be too small, or the futures too tame.
4. Stock-up ties up $7.3k of an $8k cash pile: good drama, but the payback story depends on lead time and the holding rate (≈20%/year), which the owner never told us.

---

## 3b. UI / UX (D7 mockup, design system, what's still missing)

**Attached:** `D7-pivot.html` (open it in a browser and press **▶ Auto demo** at the bottom right for the whole flow), `PIVOT-PLAN.html` (the wireframes and the reasoning behind them), and screenshots in `screens/` (1440×900, light and dark, plus one at phone width). The full spec is `docs/DESIGN.md` §12 inside `UPLOAD_ME.md`.

### Flow: one page, five steps, with a step bar at the top (`Your business · News · Analyst · Plans · Memo`)
| # | Screen | Screenshot |
|---|---|---|
| 1 | **Your business.** Left: a free-text box ("describe it like you would to a friend") and example chips. Right: the parsed fields, editable, each with a "guessed" tag where Super guessed | `1-business-light.png` |
| 2 | **News that hits your business.** Headline cards with source and date, an impact chip ("−$6.4k over 6 months if you do nothing", plus the bad case), and the verbatim quote → the number it changed. A "Your numbers" side panel. "Check live news" button | `2-news-light.png` |
| 3+4 | **Analyst + plans.** Left (≈38%): Ultra's log as typed rows (Think / Test / Result / Shoppers / Pick), a round checklist, and "Show full Nemotron thinking". Right (≈62%): the plans × futures grid filling in cell by cell, a "Do nothing" reference row, "Best today" and "Safest" badges, a green/grey/red scale. "+ Add your own plan" opens sliders (engine only, about 1 s, no LLM call) | `3-analyst-grid-light.png`, `3-analyst-grid-dark.png`, `3-grid-phone-light.png` |
| 5 | **Replay one plan** (a drawer over the grid). A generic "market scene": a supplier card, your shop vs the rival shop (price, stock bar), 60 customer dots that switch sides on an arc, and a caption bar for events. Below it, one chart: cumulative profit vs doing nothing, with a 95% band ("19 runs in 20") and week pins | `5-replay-light.png`, `5-replay-dark.png` |
| 6 | **Decision memo.** Headline, 3 numbers (gain vs do nothing · bad case · runs, with a "Nebius-verified" badge on the 10k Job), then Why / Watch out for / Recheck when / Sources with quotes. Copy, download .md, try another business | `6-memo-light.png`, `6-memo-dark.png` |

**Always visible:** a mode chip ("Example replay" / "Live"); a credibility chip counted from the real call log ("23 Nemotron calls · $0.06 · 58% cheaper than all-Ultra"); a "Powered by NVIDIA Nemotron" footer with model-role chips ("Ultra · analyst", "Super · news & setup reader", "Lightning · shoppers", "Engine · every number").

### Visual system (DESIGN §12.5)
- Inter only, with tabular numbers. No serif, mono or all-caps labels.
- Cool grey page with white cards; dark mode (`#0E1319` page) via a moon button.
- Indigo = you, amber = rival, green/red = better/worse than doing nothing. NVIDIA green is used only on the Nemotron mark.
- Corner radius: 8 px cards, 6 px controls, 4 px badges. No pills, no glows.
- Motion: View Transitions morph a grid cell into the replay drawer and the best plan's name into the memo headline. Cells count up; analyst rows stream in word by word. Reduced motion is respected.
- Plain-English copy rules: "Do nothing" (not "baseline"), "bad case (1 in 20)" (not "p5"), "gross profit", "shopper groups". Analyst rows ≤ 20 words; memo headline ≤ 12 words.

### Known gaps: D7 was drawn before v3.1, so these are specced but not in the mockup
- **Screen 1:** Country, "Share of your cost that is beans" and "Cash you could put into stock" fields.
- **Screen 2:** the cost line on each card ("Beans +31% × 85% of your cost is beans = your cost +26% (+$1.71 a bag)"), and a separate "In your market ({country})" group for local-market news, chip "Used to pick futures".
- **Screens 3+4:**
  - 2–6 futures picked by Ultra instead of the fixed 4, each header with a Likely / Possible / Unlikely tag and a "why" tooltip, plus a "Futures to test" row group at the top of the log.
  - The **cell tooltip is still the old one-liner.** It should become the 5-line P&L breakdown, the rival split ("With a rival who never runs out" / "Extra if Highland runs short") and "Cash tied up $Z, back by week W".
  - An "Over your cash" badge, and live upfront cash in the "Add your own plan" panel.
- **Screen 5:** per-node labels (cost per unit, weeks of stock, units on the way). A cumulative-cash chart toggle is P1.
- **Screen 6:** a small P&L waterfall, the rival split, a cash line, and the "Not in these numbers" box.
- **D7's mock numbers ($38/bag, $21 raw cost) don't match the real coffee fixture ($11/bag, $6.50).** D7's grid numbers are invented: in D7, "Cut price 5%" loses and "Buy 4 wk + raise 3%" wins, while the real engine (§3) currently says the cost-plus rule wins by far.

---

## 4. What we learned from live Nemotron / Tavily (feedback log highlights)

- Ultra strict JSON with thinking on works: `AnalystStep` with 3 full plans validated first try (5.6 s, ≈$0.0055). Plans were sensible and referred to the results table. It doesn't count characters: `thought` hit its 300-char cap mid-word, so we now ask for ≤250.
- Native `tools=` calling also works on Ultra with thinking on (2.9 s). We still drive the loop with strict-JSON actions because the schema is enforced there.
- Super profile parsing is accurate (currency conversion, weekly units), 1–2 s, ≈$0.0003 per call. It under-reports what it guessed, and its search terms vary run to run. A validator beats a prompt rule.
- Tavily with a news-domain allowlist often returns sitemaps and index pages rather than articles. Extract with `query` gives cheap verbatim-quote grounding (3 credits per grounded scenario).
- Budget: one LIVE analysis ≈ $0.08 in tokens plus 4–5 Tavily credits. Total Token Factory budget is $25, with $10 reserved for judges.

---

## 5. What's next (so you know what your advice can still change)

| When | Task |
|---|---|
| Oct 17 | **P3** analyst loop, futures step, shopper reactions, news watch. **F0** frontend shell (types, store, stream, mock) |
| Oct 17–20 | **F1–F3** screens: setup + news · analyst log + grid · replay + memo |
| Oct 18 | **P4** orchestrator + CLI + recorded example analyses = **Milestone A** (headless end-to-end) |
| Oct 19–20 | API v2 (SSE) and Nebius deploy = **Milestone B** |
| Oct 21–24 | Connect, polish, first LIVE runs on real businesses |
| Oct 27 | Feature freeze |
| Oct 28–29 | README, 3-minute video (coffee roaster story), Devpost text |

Cut line: P0 = everything above through the memo and replay. P1 = the 10k Job "verified" badge, user-added plan rows, the Nash price game, an Ultra-played rival in replays, a cash chart. P2 = Vietnamese UI copy and other extras.

---

## 6. What we want from you

Please answer in this order. Be concrete, and say how confident you are in each point.

### A. Model realism (most important)
1. Looking at the coffee grid in §3, which numbers would make a real coffee roaster, or a judge with a business background, stop believing the tool? For each one, what's the likely cause in the assumptions in §2, and what's the smallest fix?
2. Should the rival be smarter or dumber? Options we see: a rival with a different cost base or hedged stock; a rival that sometimes doesn't pass costs through; a rival that's slower to react. Which one makes the grid most honest without adding a new knob?
3. Is a demand noise σ of 0.1 and a ×U(0.8, 1.2) shock size enough spread for a "how bad could it get?" product? What should the 1-in-20 case look like for a small roaster in a commodity spike?
4. Should cost-plus stay as a visible plan row? If it wins, is that a feature ("sometimes the boring answer is right, and here's the proof") or a bug for the demo?

### B. The analyst (Ultra) and the futures step
5. What instructions would make Ultra propose plans that are **non-obvious but checkable**? Think staged price rises, partial hedges, or a smaller stock-up plus a supplier switch: things a busy owner wouldn't think of but the engine can test.
6. What futures should Ultra almost always include for a small importer or producer that we might be missing (for example a currency move expressed as an input-price change, or a local rival opening)?
7. Any failure modes you'd expect in the futures step (duplicates, cherry-picking only scary cases, citing news that doesn't support the case) that a validator in code should catch?

### C. Creativity: make it memorable for judges
8. Three ideas, each buildable by one Claude session in under a day, that would make a judge say "oh, that's clever" in the first 30 seconds of the video. Use what we already have: the grid, the P&L bridge, the rival split, the cash/payback numbers, the week-by-week replay and the shopper-group bubbles.
9. How should the memo open? Write 2 example memo headlines and "why" lines for the coffee roaster that sound like a sharp human advisor, not a chatbot. Use only numbers from §3.
10. Ideas that would strengthen our **Best Use of Tavily** case (country-aware local-language search, verbatim quotes, the "Check live news" button…) that cost few credits. We're on the free plan: 1,000 credits/month.

### C2. UI / UX (look at the screenshots and run D7's Auto demo)
12. **First 10 seconds:** a judge lands on screen 1 cold. Do they understand what this is and why it's different from "ChatGPT, what should I do?" What would you change on screen 1 or in the top bar?
13. **The grid is the hero.** Is a plans × futures grid of dollar cells readable for a small-business owner? With up to 6 columns and the v3.1 tooltip (5-line P&L, rival split, cash), how do we keep it from becoming a spreadsheet? Sketch, in words, the best cell and tooltip layout.
14. **Where should the v3.1 "honesty" go** (cost line, P&L waterfall, rival split, cash/payback, "Not in these numbers") so it builds trust without cluttering? Which items belong on the main screens, and which behind a click?
15. **The replay scene.** Does the market scene (supplier → two shops → customer dots) earn its space, or is it eye candy? What one change would make it *explain* the plan (for example, showing the cheaper stock being sold, or the moment the rival runs out)?
16. **The analyst log.** How do we make Ultra's reasoning feel like an expert at work rather than a chat transcript? Is "Show full Nemotron thinking" the right depth?
17. **Memo:** what would make an owner screenshot it and send it to their business partner?
18. List the 5 most important UI fixes before Oct 24, ranked. Note anything that looks off in dark mode or at phone width.

### D. Risks
11. What's the single biggest risk to winning this track, given the plan and dates in §5? What would you cut first if we fall behind?

**Format:** numbered answers matching the questions above. Keep each answer under 150 words, except question 8. End with a top-5 list of what you'd do first, in order.
