# Design brief: Market Digital Twin UI

Status: **exploring.** Five mockup directions (D1–D5) are being built so we can compare them side by side. Once one is picked, the "Decisions" section (§11) gets filled in, and that becomes the spec for the restyle of `frontend/`.

## 1. The problem with the current UI

The T10–T12 shell works, but a first-time visitor can't tell what is happening:
- **Everything has the same weight.** About 40 numbers, 12 coloured badges and 3 columns all compete, and nothing says "look here first".
- **It uses internal jargon:** c_raw, ω, ROP, Π, U1/U2, Δπ, "MC-10K: IDLE".
- **There's no story.** Nothing explains what the question is, what just happened, or who is winning.
- **It looks AI-generated:**
  - neon outlines on every card, with glows and pulse dots everywhere;
  - monospace ALL-CAPS labels;
  - a badge on everything;
  - an empty "Institutional Decision Intelligence" kind of tone.

**The goal:** in **10 seconds** a visitor knows the question. In **60 seconds** they've watched the answer play out. They can explain it to someone else afterwards.

## 2. The story (every direction must tell this)

> **A real news shock hits a market. One company is run by an AI CEO (NVIDIA Nemotron). We replay the exact same market in a parallel world where that company follows a textbook pricing rule instead. Same shock, same rival, same shoppers. Only the boss is different. Does the AI earn more?**

How this maps to the engine (don't show these terms to visitors):
- **AI world (U1):** Firm A's CEO is Nemotron Ultra, and so is Firm B's.
- **Rule world (U2):** Firm A uses cost-plus pricing. Firm B repeats exactly what it did in the AI world ("rival held fixed").
- **AI advantage (Δπ):** Firm A's profit in the AI world minus its profit in the rule world, run 10,000 times.

The three beats a visitor should notice, in order:
1. **The shock:** a real news card (Tavily). "US raises chip tariff to 25%" → supplier cost +25%, shipping 4 → 7 weeks.
2. **The decisions:** the AI CEO's choice in plain English ("Raise price $90 → $94 and order 20% extra stock"), with a one-line reason.
3. **The outcome:** shoppers move in the arena, the rival sells out, and profit lines split apart. It ends with a verdict: "AI advantage: **+$114k** (95% sure it's between +$82k and +$146k, over 10,000 simulations)."

## 3. Information hierarchy

| Level | What | Where |
|---|---|---|
| 1 · Hero | The question + the live **AI advantage** number + who's ahead | Top, biggest type on the page |
| 2 · Show | Pixel arena with event captions; timeline with event markers | Main area, about 60% of the width |
| 3 · Explain | AI decision cards (plain decision + short reason, expandable to the full Nemotron reasoning) and the news cards | Side rail |
| 4 · Prove | 3 simple charts: profit AI vs rule, price A vs B, stock on shelf | Below the arena |
| 5 · Analyst | Price game (Nash 3×3), order swing (bullwhip), stats table (CI, Cohen's d, p, χ²), model telemetry, Monte Carlo job | **"Analyst view" tab**, hidden by default |
| Credibility chip | "142 Nemotron calls · $0.21 · 62% cheaper than all-Ultra" | Small, top bar or footer |

**Run flow:**
1. **Intro state.** Show the question, three numbered steps ("Real news sets the shock → Nemotron runs Firm A → The engine scores both worlds"), the scenario picker and a big **▶ Play** button.
2. **Run state.** The replay plays. Captions appear on the arena for each event, and the timeline fills in.
3. **End state.** A verdict card: the AI advantage with its range, the 2–3 decisions that made the difference, and "Replay", "Try another scenario" and "Open analyst view".

## 4. Plain-language glossary (UI copy must use the left column)

| Show this | Instead of | Notes |
|---|---|---|
| Week 12 | tick 12 | 1 tick = 1 week |
| Supplier cost | c_raw | "$52 → $65 per unit" |
| Shipping time | lead time L | "4 → 7 weeks" |
| Reorder point | ROP | Analyst view only |
| Safety stock | ω (omega), buffer | "+20% extra stock" |
| AI world / Rule world | U1 / U2 | |
| AI advantage | Δπ, strategic alpha | |
| "95% sure it's between X and Y" | CI95 | Analyst view may show "CI95" |
| Didn't buy | outside good, bank | |
| Switched because shelves were empty | spillover | |
| Ran out of stock | stockout, unmet > 0 | |
| Shopper groups | crowd archetypes | "Budget students", "Loyal families"… |
| Price game | Nash matrix | Analyst view |
| Order swing | bullwhip ratio | Analyst view |
| Nemotron Ultra · CEO / Nemotron Super · news reader and stock planner / Nemotron Lightning · shoppers | tier badges | Model names stay (NVIDIA judges), but always next to the job they do |

## 5. Shared colour meaning (hues fixed; each direction tunes the tones)

| Meaning | Hue | Also shown by |
|---|---|---|
| Firm A (the AI-run company) | indigo/blue-violet | a circle marker; "A" |
| Firm B (rival) | amber/orange | a square marker; "B" |
| Rule world (Firm A under the textbook rule) | neutral grey, **dashed** line | dashed stroke |
| Gain / good | green | "+" sign |
| Loss / ran out / bad | red | "−" sign, icon |
| Didn't buy | light grey | |
| NVIDIA green `#76B900` | **only** for the "Powered by NVIDIA Nemotron" mark and model chips | never for data |

Colour is never the only signal: pair it with a shape, sign or label. Text contrast must meet WCAG AA.

## 6. Type and numbers

- Use a **sans-serif for all UI text.** Monospace or tabular figures are for numbers only (`font-variant-numeric: tabular-nums`).
- **Type scale:** hero number 48–64 px · section title 18–20 px · body 14–15 px · captions 12–13 px. Nothing smaller than 12 px.
- **Case:** sentence case everywhere. ALL CAPS only for tiny overlines, and sparingly.
- **Money:** `$94.00` for prices · `$15.5k` / `$1.2M` for profit · always signed for deltas (`+$114k`, `−$8.2k`, using a real minus sign).
- **Percentages:** 1 decimal place at most.
- **Time:** "Week 12 of 24".

## 7. The pixel arena (D1, D2, D4 and D5 use it as the hero; D3 extends the style to the whole UI)

- **Grid and rendering:**
  - Canvas 2D, a 16 px tile grid drawn at 2× or 3× scale, `image-rendering: pixelated`, integer positions only.
  - Every sprite is drawn **procedurally in code**. No image files, so it ships as one file.
- **Scene, left to right:**
  - **Harbour/supplier:** a dock, a ship and a truck road.
  - **Two storefronts:** Store A has an indigo awning, Store B an amber one. Visible shelves show the stock level as items on the shelves.
  - **Town square:** the shoppers.
  - **A small "home" area** for people who didn't buy.
- **Shoppers:** 8×12 px people with a 2-frame walk cycle. Shirt colour = where they last bought (A, B or grey for didn't buy). 200 of them.
- **Events:**
  - **News shock:** a storm cloud or "TARIFF" stamp over the harbour, and trucks slow down.
  - **Price change:** a price tag above the store pops ("$90 → $94").
  - **Running out:** a "SOLD OUT" sign, then people walk on to the other store.
  - **Shopper thoughts:** a speech bubble above 3–5 people ("too pricey, trying B").
- **Captions:** a caption bar at the bottom of the arena narrates each event in one sentence. Each caption stays for about 4 s and also lands in the timeline.
- **Motion:** smooth but calm. No screen shake, no glow, and nothing blinking except a live dot.

## 8. Anti-checklist (if a mockup does these, it fails)

- Neon or glowing borders around every panel, panels nested inside panels, or gradient text
- More than one accent colour per panel
- Monospace or ALL-CAPS labels for normal UI text
- Badges or chips on everything; emoji used as decoration
- Placeholder or dev labels ("T12 CANVAS SLOT", "MOCK/REPLAY STREAM", "E=0")
- Jargon from the right-hand column of §4 outside the analyst view
- Empty states that just say "Initializing…" (say what will appear and why)
- Purple-to-blue hero gradients, glassmorphism, or a stock "AI sparkle" icon

## 9. Mockup brief (shared by D1–D5)

Each mockup is **one self-contained HTML file** at `docs/mockups/<ID>-<name>.html`:
- **Libraries and fonts:**
  - Tailwind from the CDN (`https://cdn.tailwindcss.com`) or plain CSS, plus vanilla JS.
  - Fonts from Google Fonts only.
  - No other network requests. No images; draw everything with CSS, SVG or canvas.
- **Size:** designed for **1440×900** and still usable at 1280×800. No page-level horizontal scroll.
- **Demo:** a **scripted demo of about 60 s that plays automatically** after ▶ Play, with the mock data below. It goes intro → run → end verdict. Include a "Replay" button.
- **What it must include:**
  - every level of §3, and everything in §10;
  - a working **Analyst view** tab, where static mock content is fine;
  - the intro, run and end states.
- **Labels:** a small fixed label in the corner: "<ID> · <direction name> · mock data".
- **Code:** readable, so a Claude session can port it to Next.js + Tailwind. Use CSS variables for every colour and the font stack at the top.
- **Length:** keep it under ~1,200 lines.

### Mock data (GPU Tariff Shock, 24 weeks, 200 shoppers)

| Week | Event | Numbers |
|---|---|---|
| 0 | Calm market | A $90, B $90 · supplier cost $52 · shipping 4 weeks · shares A 41% / B 39% / didn't buy 20% |
| 2 | **News:** Reuters, "US raises tariff on imported chips to 25%" | supplier cost $52 → $65 · shipping 4 → 7 weeks |
| 3 | **AI CEO A** (Nemotron Ultra, 12 s of thinking) | "Raise price $90 → $94 and order 20% extra stock." Reason: "B's warehouse is thin and shipping just got slower. If B runs out, its shoppers come to us, so I'd rather hold stock than chase volume." |
| 3 | **CEO B** (Nemotron Ultra) | "Raise price $90 → $91.50, no extra stock." |
| 3 | **Rule world:** Firm A applies cost-plus | price → $97.50 (cost + 50%), no extra stock |
| 4 | **Shopper groups** (Nemotron Lightning) | "Budget students: too pricey, trying B" · "Loyal families: sticking with A" |
| 7 | **Firm B runs out** | 38 shoppers switch to A · B's sold-out sign stays up for 3 weeks |
| 9 | **Rule world:** Firm A also runs out | its shoppers leave to "didn't buy" |
| 12 | **AI CEO A** | "Hold at $94, cut extra stock to 10%. B is restocking." |
| 16 | Price game | Both firms "hold": the price game settles at equilibrium |
| 24 | **End** | Firm A profit: AI world $412k vs rule world $298k → **AI advantage +$114k** (95% range +$82k to +$146k, 10,000 simulations, cloud-verified) |

- **Profit curves:** both start at 0. They track together until week 7, then the AI line pulls away. Add mild noise.
- **Telemetry chip:** 142 Nemotron calls · Ultra 8% of calls / 71% of tokens · $0.21 · 62% cheaper than all-Ultra.

## 10. Adopted from the A10 references and the A11 copy deck (all mockups use these)

The full answers are in `docs/design-research/`: `A10-references.md` (references per direction, arena techniques) and `A11-copy-deck.md` (captions, decision cards, verdicts, tooltips, empty states). **Use their copy; don't write your own.** Where they conflict with §1–9, §1–9 wins.

**Working name: "Market Twin".** Tagline: "Same news, two worlds: can an AI CEO beat the textbook rule?" The final name is picked after A13.

**Explaining what happened:**
- **Beat cards in the side rail.** Each card ties three things together:
  - a header: "Week 3 · Nemotron Ultra · CEO · thought for 12 s";
  - the decision, bold, one line;
  - "Why:", one line;
  - a muted footer with a dashed left border: "In the rule world: price → $97.50, no extra stock";
  - a link: "Show full Nemotron thinking ▾".

  The active card gets a slightly lighter surface, with no outline glow. (Ramp + Cursor + Stripe Radar)
- **News card → effect.** The headline links to delta chips ("Supplier cost $52 → $65", "Shipping 4 → 7 weeks"), which point into the next decision card. (Flighty)
- **A caption bar docked inside the bottom of the arena:**
  - 36–40 px tall, one sentence, a 4 s progress underline;
  - a small coloured tab on the left for the event type (shock, decision, sold out, shoppers);
  - the layout never shifts. (Lichess review + RollerCoaster Tycoon ticker)
- **A bookmarked timeline** under the arena, Weeks 0–24:
  - one notch per beat ("Wk 2 Tariff", "Wk 3 AI orders +20%", "Wk 7 B sells out", "Wk 9 Rule-A sells out", "Wk 12 AI trims stock");
  - clicking a notch jumps to that beat and shows its caption again. (Distill)

**Charts:**
- All charts share the Week 0–24 x-axis, and **one playhead line** sweeps across all of them. (TradingView)
- Vertical event markers at the beats, each with a flag on the curve ("Wk 7: B sells out → +38 shoppers to A"). (Bloomberg/FT)
- **Label lines at their right end** ("AI world $412k", "Rule world $298k", with a bracket "+$114k"). No floating legends. (Koyfin)
- **Titles state the finding:** "Profit: AI pulls ahead from week 7", not "Profit". (FT)
- The profit chart has a light indigo 95% band around the AI line. (NYT Upshot)
- The confidence pill sits on the hero number's baseline: "95% sure: +$82k to +$146k · 10,000 simulations". (Vercel)

**The arena** (A10 §2 has the exact numbers):
- **Shoppers:** an 8×12 sprite of head, shirt, legs and a ground shadow, 4 colours, 2 frames every 180 ms.
- **Shelves:** 10 crates per store, `ceil(stock% / 10)`.
- **Speech bubbles:** at most 4 at once, at least 48 px apart. Two beats: a "!" icon for 350 ms, then the phrase.
- **Text:** bubbles and price placards use crisp sans-serif text (or DOM overlays), never scaled pixel text. (Habbo)
- **Price placards:** always visible over each store. On a change they pop to 1.25× for 400 ms showing "$90 → $94". (Kairosoft)
- **Trucks:** speed ∝ 1 / shipping time.
- **The tariff hit:** a "25% TARIFF" stamp and a storm cloud over the harbour. (OpenTTD + Papers, Please)
- **Week 7:** 38 shoppers visibly walk from B's "SOLD OUT" door to A, and their shirts turn indigo. (Mini Metro)
- **Before ▶ Play:** the arena already shows the calm week-0 town, never an empty box.

**Copy:**
- **Shopper groups** use the friendly names from A11 §8 (e.g. "Budget students (loyal to A)").
- **The end verdict** uses A11 §5 template A (the mock data is a win). Templates B (tie) and C (AI loses) must also fit the same card later.

**Chrome:** at most one live dot on the page. The "Story / Analyst" toggle sits top right. The NVIDIA mark + credibility chip goes in the top bar.

**Light vs dark (A10 §4):** A10 recommends light as the default for video, projectors and Devpost thumbnails, with dark either as a toggle or for the analyst view only. Its evidence is unverified, so D1–D5 still test this, and A12/A13 decide.

## 11. Decisions (locked Oct 14 after A12/A13 and the user's review)

> **Superseded in part on Oct 15.** The theme, fonts, colour tokens, shape and arena rules below are replaced by **§12.5** (D7 mockup). The text budget, the anti-checklist and the "Banned" list still hold.

**Where §11 conflicts with §1–10, §11 wins.** The full reasoning is in `dist/argon/A12/` and `dist/argon/A13/` (not committed).

- **Direction:** **D4 · Explainer** (editorial voice, inline colour-coded entity pills, the "how we know it wasn't luck" section, 10,000-run histogram), laid out on **D1 · Daylight**'s single-screen workbench.
- **Theme:** **light only.** No dark toggle. Warm paper page, white cards.
- **The user's two must-haves:**
  1. **The pixel arena is the hero and it is big.** About half the screen, never shrunk to a strip. The pixel world is what people remember.
  2. **The live "track" runs beside the arena**, not below it: the three stacked charts (profit, price, stock on shelf) share one playhead and move with every week.
- **One screen, no page scroll.** Everything fits 1440×900 (and works at 1280×800). Only the story rail scrolls, *inside itself* (`rail.scrollTo`), never `window`. No `scrollIntoView` on the page.
- **Text budget (the #1 complaint was "too much text"):**
  - Story beat: one headline of ≤ 8 words + one sentence of ≤ 25 words. Nothing else visible by default.
  - The CEO's full reasoning and raw thinking sit behind "Show thinking ▾".
  - Arena caption: one sentence, ≤ 14 words. Max 4 speech bubbles, ≤ 5 words each.
  - Numbers do the talking: prefer a delta chip ("$90 → $94") over a sentence that says it.
  - Stats explained in plain words only in the end section.
- **Layout (1440×900):**
  - Top bar (≈ 56 px): name, scenario picker, Play/Replay, Story | Analyst tabs, credibility chip.
  - Hero row (≈ 72 px): the big live **AI advantage** counter (starts at **+$0k, "Both worlds tied at start"**, grows to +$114k), plus D2's 3-row readout: ● AI world · --- Rule world · ■ Firm B.
  - Main row: **arena ≈ 60% width** (left) with its caption bar docked at its bottom; **chart track ≈ 40%** (right) with the three small charts stacked.
  - Bottom row (≈ 200 px): the bookmarked timeline (full width) and, under it or beside it, the story rail that scrolls internally.
  - The verdict replaces the story rail at the end (the arena and charts stay visible, frozen at week 24).
- **Fonts (Google Fonts):** `Newsreader` (500, 600, 400 italic) for headlines and the verdict; `Plus Jakarta Sans` (400–700) for UI and body; `JetBrains Mono` (400–600, `tabular-nums`) **only for numbers**.
- **Colour tokens:**
  ```css
  --bg-paper:#FAF8F5; --bg-card:#FFFFFF; --bg-subtle:#F3EFEA;
  --ink:#18181B; --ink-2:#52525B; --ink-3:#71717A;
  --line:#E4E0D8; --line-strong:#D4CFC5;
  --firm-a:#4F46E5; --firm-a-soft:#EEF2FF;   /* ● indigo circle */
  --firm-b:#D97706; --firm-b-soft:#FEF3C7;   /* ■ amber square */
  --rule:#6B7280;   /* dashed grey */  --no-buy:#9CA3AF;
  --gain:#15803D; --gain-soft:#DCFCE7; --loss:#B91C1C; --loss-soft:#FEE2E2;
  --nv-green:#76B900; /* brand mark and model chips only */
  ```
- **Spacing and shape:** 4 px grid; 16 px gaps; radius 6 px (cards, arena frame), 4 px (buttons, beat cards), 3 px (pills, chips). Shadows almost none: `0 1px 2px rgba(24,24,27,.03)`; only floating placards/tooltips get `0 2px 8px rgba(24,24,27,.10)`.
- **Arena:** D1's `.diorama-frame` (1 px `--line-strong` border, inset top highlight). Max 16 canvas colours (A13's palette is fine). Shoppers follow waypoints, not random jitter: square → walk to a store door → pause → exit with shirt colour → square or home. At week 7 the 38 switchers walk to B's SOLD OUT sign, show a "!" for ~350 ms, then walk diagonally into Store A. Sprites must read clearly: draw at 3× on a 1440-wide screen.
- **Taken from the other mockups:**
  - D1: the arena frame; the single-screen grid; the "+$0k, tied at start" opening state.
  - D2: the 3-row world readout in the hero.
  - D3: event pins sitting **on** the timeline track, each at exactly `week / 24 × 100%`; D3's pixel charm (but not its game fonts or wooden chrome).
  - D5: Firm B's own Nemotron Ultra decision card (so judges see the rival is an AI too); one crosshair that scrubs all three charts together; keyboard shortcuts `Space` play/pause, `←/→` step a week, `A` analyst view.
- **Banned (found in D1–D5):**
  - Any "preview outcome" / "AI wins · Tie · AI loses" / "State: Intro · Run · End" switcher in the UI. The verdict template follows the data.
  - HTML comments citing DESIGN.md or prompt sections.
  - A scenario picker that only changes the headline. In the mockup, show one scenario and mark the others "(coming soon)".
  - Polished paragraphs pretending to be raw thinking. Mock thinking must look like scratch math (`94 − 65 = $29 margin`, `165u ÷ 35u/wk ≈ 4.7 wks`).
- **Mock-data fix:** stock can't jump before the order arrives. Firm A's extra order (week 3, shipping 7 weeks) lands at **week 10**; until then show "+20% order in transit · arrives wk 10" on the stock chart and above Store A. Telemetry is the same everywhere: 142 calls = 12 Ultra + 26 Super + 104 Lightning.
- **Real app (Oct 21+):** port this into `tailwind.config.ts`, `globals.css` and `app/page.tsx`, reuse T11/T12 components, and fix the arena going black on resize.

## 12. Pivot screens (2026-10-14, "Test your plans"; wins over §2, §3, §9 and §10's story, and over §11's layout)

**Status: decided.** The wireframes and reasoning are in `docs/PIVOT-PLAN.html` (open it in a browser). The behaviour is in SPEC §15 and the contract in `docs/EVENTS.md` v2.

**What still holds from §11:**
- the text budget;
- the anti-checklist (§8) and §11's "Banned" list;
- §4's plain-language glossary.

The look (theme, fonts, colours, shape) and the replay illustration are now **§12.5**, which replaces §11's visual rules and the §7 pixel arena.

§4's glossary additions: "Do nothing" (not "baseline"), "bad case (1 in 20)" (not "p5"), "gross profit", "shopper groups".

**Firm A is the user's business** (indigo ● with the business name). **B is the named rival** (amber ■).

### 12.1 Flow and routing

One page, five steps, with a thin step bar at the top: `Your business · News · Analyst · Plans · Memo`. Steps 3 and 4 share a screen.

| # | Screen | Shows | Main action |
|---|---|---|---|
| 1 | **Your business** | Left: a free-text box ("Describe it like you would to a friend") and 3 example chips. Right: the parsed fields, editable; guessed fields carry a small "guessed" tag. | "Read my business →", then "Looks right → find news" |
| 2 | **News that affects you** | 3–5 headline cards: source · date, headline, a coloured impact chip ("−$6.4k over 6 months if you do nothing"), the verbatim quote → the number it changed. The card used for the grid is marked. "Check live news" button. | "Find the best plan for this →" |
| 3+4 | **Analyst + plans** | Left (≈ 38%): the analyst log, one row per `agent_step` with a type tag (Think / Test / Result / Shoppers), and "Show full Nemotron thinking ▾" per round. Right (≈ 62%): the **plans × shocks grid**, which fills in cell by cell. Row label = plan name, plus small text badges "Best today" (`best_today`) and "Safest" (`safest`). Columns = the 2–6 futures (§12.3a), with today's news highlighted. Each cell: the big `mean_delta_usd` plus a small "bad case −$1.8k". Colour scale: green = better than doing nothing, grey ≈ same, red = worse, always with a +/− sign. A "Do nothing" reference row shows baseline profit. "+ Add your own plan" opens 4 sliders (price %, from week, extra stock weeks, switch supplier). Clicking a cell opens screen 5. | "See the memo →" once `memo` arrives |
| 5 | **Replay one plan** (drawer or full view over the grid) | The market scene (§12.5) at the top, captions from `marker` events; **one** chart below: cumulative gross profit, plan vs do nothing (dashed), with the 95% band; timeline pins from markers. Price/stock charts and the Nash matrix live in the Analyst tab. | Play / pause, step weeks, back to grid |
| 6 | **Decision memo** | Recommendation headline; 3 numbers (+$ vs do nothing · bad case · runs, with a "Nebius-verified" badge when `verified`); Why; Watch out for; Recheck when; Sources with quotes and links. | "Copy" · "Download .md" · "Try another business" |

### 12.2 Always visible

- **Top bar:** name, the step bar, a mode chip (Example replay / Live), and the credibility chip from `telemetry` ("23 Nemotron calls · $0.06 · 58% cheaper than all-Ultra").
- **"Powered by NVIDIA Nemotron"** mark, and model chips next to the job they do: "Ultra · analyst", "Super · news & setup reader", "Lightning · shoppers".

### 12.3 Copy rules for the new screens

- Analyst rows: ≤ 1 sentence, ≤ 20 words; numbers as chips.
- Grid cells: numbers only; the explanation goes in a hover/tap tooltip ("Average over 1,000 runs; in 1 run out of 20 it's worse than −$1.8k").
- Memo: headline ≤ 12 words; each section ≤ 2 sentences.
- Empty states say what will appear and why ("Nemotron will test plans here. Each cell = 1,000 simulated runs.").

### 12.3a Realism update (v3.1, 2026-10-15; SPEC §15 v3.1, EVENTS v2.1). Wins over 12.1 where they conflict

Goal: every number can be checked with a calculator, and every assumption is visible. More screens aren't the goal; showing *where numbers come from* is.

- **Screen 1:** add the fields **Country**, **Share of your cost that is {input}** (e.g. "85% of your cost is beans", tagged "guessed" when it is) and **Cash you could put into stock** (optional, empty = "not given").
- **Screen 2:**
  - Each supply card shows the **cost line** verbatim: "Beans +31% × 85% of your cost is beans = your cost +26% (+$1.71 a bag)".
  - Local-market cards (`kind: "market"`) sit below them under the label "In your market ({country})". They have no impact chip; their chip says "Used to pick futures".
- **Screens 3+4:**
  - The analyst log gets a first row group, **"Futures to test"** (Ultra's step 0b `thought`), before the plan rounds.
  - **Grid columns = 2–6 futures**, not 4. Each column header has the label, a likelihood tag (Likely / Possible / Unlikely), and its `why` in the tooltip. Today's news stays highlighted. Below 1024 px the grid scrolls sideways inside its card; the page never does.
  - **Cell tooltip = the P&L breakdown**, five lines that add up (plain labels: "Cheaper stock", "Your price change", "Customers won/lost", "Marketing", "Storage & money tied up"), then a total line. Under it, two lines: "With a rival who never runs out: +$X" and "Extra if {rival} runs short: +$Y". Then "Cash tied up: $Z, back by week W".
  - An **"Over your cash"** badge appears on cells with `over_cash`, in the warning colour, never red fill.
  - "+ Add your own plan" shows the plan's upfront cash live as the extra-stock slider moves, and the badge when it exceeds the cash given.
- **Screen 5:** scene nodes carry small mono labels from the tick: cost per unit, weeks of stock, units on the way. Keep the shoppers; they're the demo's hook. The cumulative-cash chart toggle is P1.
- **Screen 6:**
  - Under the 3 numbers, add the **P&L breakdown** as a small waterfall (five bars + total) and the rival split.
  - Add a cash line when the plan buys stock: "Needs about $Z of cash up front · pays back by week W" (or "Over the $C you said you have").
  - End with the **"Not in these numbers"** box: SPEC §15.11's fixed list, plus Ultra's found risks with their source links.
- **Copy:** never "psychic" upside. A gain that depends on the rival running short is always labelled that way.

### 12.4 Mobbin references (what to borrow; links in `docs/PIVOT-PLAN.html`)

- **Setup:** Apollo (input left, AI-filled editable fields right), HubSpot ("describe it to a friend").
- **News:** Fey (stream with impact numbers), Quicken (news beside your numbers).
- **Analyst:** Browserbase (typed step rows), Elicit (status steps beside a live result).
- **Grid:** Profound (matrix with colour intensity), Kiwi.com (dense number grid with a selected cell).
- **Replay:** Quicken (high/expected/low band with marker lines).
- **Memo:** Gemini Notebook (report with sources), Semrush (summary on top, evidence below).

### 12.5 Visual system (decided Oct 15 from the D7 review; replaces §11's theme, fonts, tokens, shape and §7's arena)

The reference is `docs/mockups/D7-pivot.html`. The user asked for "modern, not creamy, not too curved", in the style of `docs/PIVOT-PLAN.html`.

- **Theme:** **light and dark.** The page follows the system setting, and a moon button in the top bar switches it (saved per browser). Both themes use the same token names; dark redefines them under `@media (prefers-color-scheme: dark)` and `:root[data-theme=dark]`. Cool grey page, white cards (dark: `#0E1319` page, `#161C25` cards).
- **Font:** **Inter** (400–700) for everything, including numbers. Numbers use `font-variant-numeric: tabular-nums`. No serif, no monospace, no all-caps labels.
  - **Type scale:** page title 26 px, card title 18 px, body 14 px, captions 12–13 px. Headings are weight 600 with slight negative tracking.
- **Light tokens:**
  ```css
  --bg-paper:#F6F7F9; --bg-card:#FFFFFF; --bg-subtle:#EEF1F5; --bg-sunk:#F8FAFC;
  --ink:#17202E; --ink-2:#4A5565; --ink-3:#6B7686; --line:#E3E7ED; --line-strong:#D3D9E2;
  --firm-a:#4F46E5; --firm-a-soft:#EEEDFD;   /* you */
  --firm-b:#C2700A; --firm-b-soft:#FDF1E1;   /* rival */
  --gain:#16794A; --gain-soft:#E3F3EA; --loss:#B42318; --loss-soft:#FBE7E4;
  --nv-green:#76B900;                         /* NVIDIA mark and model chips only */
  ```
  The dark values are in the D7 file. Never hardcode `#fff` text on a coloured fill; use `--on-accent` or `--on-ink`.
- **Shape:**
  - Corner radius: **8 px** for cards, panels and the replay drawer; **6 px** for buttons, inputs, chips, grid cells and the step bar; **4 px** for badges and tags. No full pill shapes.
  - Shadows stay soft: cards `0 1px 2px` at 4%, floating panels and tooltips a larger soft shadow. No glows.
- **Motion:**
  - Screen changes use the View Transitions API. These shared elements morph between screens:
    - grid cell → replay drawer;
    - news chip → grid column header;
    - best plan's name → memo headline;
    - business pill.
  - Grid cells count up while their colour fades in. Analyst rows stream in word by word.
  - Everything respects `prefers-reduced-motion`.
- **Replay illustration: the market scene** (replaces the §7 pixel arena). It is general, not tied to one product.
  - **Layout:** one canvas, 900×320 logical, drawn with the theme tokens.
    - **Supplier card:** raw cost +% and lead time, or a "Port shut" tag.
    - **Two shop cards**, you (indigo) and the rival (amber): the price, which pops "$38.00 → $39.14" on a change; a stock bar in weeks, which shows "Sold out" when empty; "+N wk of stock on the way".
    - **60 customer dots** in three groups: buy from you · buy from the rival · not buying.
    - **The header line:** "N customers buy from you, ±M vs do nothing".
  - **Motion:**
    - Boxes travel the supplier → shop routes. They slow down after a shock, stop while the port is shut, and a highlighted batch arrives in the stock-arrival week.
    - Customers who switch fly over one at a time on an arc and change colour.
    - At most 2 speech bubbles, ≤ 6 words.
  - **Text:**
    - Names and labels come from the business profile (`business_name`, `rival_name`). The copy says "raw cost", "stock" and "customers", never a product word.
    - A caption bar under the scene shows the `marker` text.
- **Panels added from the Mobbin references (§12.4):**
  - **News:** "Your numbers" beside the headlines (Quicken).
  - **Analyst:** a round checklist above the log (Elicit).
  - **Grid:** your own plan rows outlined in indigo, and the best plan's name underlined (Profound).
  - **Replay:** "This plan" settings and the chart key beside the chart (Quicken).

### 12.6 Dry Run look (decided Oct 20; replaces §12.5's fonts, colours and shapes)

The product is now called **Dry Run** ("try your plan on 200 customers before you try it on real ones"). The reference is `docs/mockups/D8-faces.html`. Code: `frontend/lib/faces.ts`, `frontend/components/faces/` (`PixelFace`, `PixelLogo`, `PixelCrowd`, `CustomerPreview`, `faces.css`, and `dryrun.css`, the skin that is loaded last over every stage).

- **Pixel customers.** Each of the 12 shopper types is a 20×20 pixel face, drawn in code with no image files. Looks are fixed per archetype id, so the same person appears on every screen.
  - **The face is the data:** μ_A sets five expressions (grin, smile, flat, annoyed, sad with a tear).
  - Income sets the shirt, deal hunters squint, and the disc colour is where they lean (blue = you, orange = rival, grey = no change).
  - Motion moves in whole pixels only (`steps()`): blink, bob, and a pop when the mood changes.
- **Where faces appear:**
  - the shopper card in Test plans: compact, 52 px faces, name only, with details in the speech bubble;
  - the landing preview panel: large faces, sample plans, marked "Example reactions".
  - Speech bubbles have stepped pixel corners.
- **Landing:**
  - a serif headline;
  - a blue pixel-grain field with two pixel shops and 200 pixel customers, where one sometimes walks across;
  - the input box overlaps the field;
  - examples (4 across), then the customer preview, then "how it works".
- **Mark:** a pixel face raising one eyebrow, white on ink blue (`PixelLogo`, `app/icon.svg`).
- **Type:**
  - **Instrument Serif** for page/card titles only. **Every number (grid cells, KPIs, hero figure, hover card, simulator counts, table money) is the sans at weight 700 with tabular digits**, because the serif's thin strokes are hard to read for money. The answer page uses the same skin: hard-shadow paper card, mono overlines and square tags, dashed callouts, heatmap-coloured table cells with pixel-block bars, accent bar on the recommended row;
  - **Inter** for UI and body;
  - **JetBrains Mono** only for small all-caps overlines, step numbers and tags.
- **Colour (light):**
  - paper `#F3EFE4`, card `#FFFDF8`, ink `#1B1A17`;
  - accent and "you" ink blue `#3B4BDB`, rival `#D9822B`;
  - dark-mode values are in `components/flow/flow.css`. NVIDIA green is still only for the model chips.
- **Shape:** cards 10 px, controls 6 px, tags 3 px, pixel parts square. No pills, glows or gradients.
- **Hard pixel shadow:** only on the input box, the primary buttons and the example cards on hover (`3–6px 3–6px 0`). It presses in on click.
- **Answer header:** the same blue pixel-grain field, with a white serif headline and number.
- **Simulator chart:** a block chart, not a line fan. 40 square blocks (1 block = 1/40 of the runs) sit along "profit vs doing nothing" and stack where outcomes pile up. Green blocks beat doing nothing, coral ones are worse. The share of green blocks is the box's real `p_better`, and a dashed "Do nothing" line and an "avg" marker are labelled. Users found the old fan of wiggly lines hard to read.
- **Plan × future grid:** a warm paper heatmap (`--g3…--r2` overridden in `dryrun.css`) with square cells. Hovering a cell lifts it with the hard shadow. Waiting cells blink in steps. The hover card has a 2 px ink edge, a hard shadow, no glow and a serif number.
  - **Cells (Test plans grid and the memo's "How it compares" table):** a 16 px sans-700 number with a small pixel block meter to its left (`BlockMeter`), the same block vocabulary as the simulator chart and the replay week strip. Up to 5 square blocks: green stacked up for a profit, coral stacked down for a loss, count = |value| ÷ the biggest |value| in the grid × 5, rounded, at least 1; one grey dash for about even. `cellMeter` in `lib/gridmarks.ts` holds the thresholds (about even: under $100 or under 5% of the biggest swing). Waiting cells and the "Do nothing" row show no meter. The memo table's old bar under each number is gone, since the meter says the same thing.
  - **Column headers:** no sentences, no pictograms. Each driver of a future is one square mono tag chip (`futureChips` in `lib/gridmarks.ts`, drawn in `GridMarks.tsx`) with a signed delta and a 5×3 pixel arrow: `COST ▲30%`, `RIVAL ▼5%`, `DELAY +2 WK`, `NEW RIVAL`, `DEMAND ▼10%`. Chips come from the shock-case fields, never the label, and are coloured by the effect on the user (coral bad, green good, grey neutral). A compound future stacks its two biggest drivers; if no field moves, one grey chip shows the label's first words. Today's headline carries a `NEWS` tag. The full label, cost line and "why" sit in the header's `title` tooltip.
- **Replay ("Watch one run", `components/replay/`):** one run, two futures. The header has a mono overline, the serif plan name, the future, and the honest "one sample run, the average of 1,000 runs is +$X" note. Square pixel buttons with hard shadows sit under it. Below that:
  - a three-block scoreboard (Do nothing / With the plan / Gap, cumulative) with a "WEEK n / 24" tag;
  - **twin pixel worlds** (`TwinScene`, a canvas drawn at low resolution and scaled with `image-rendering: pixelated`): left Do nothing, right the plan, same week and same seed. Each world has your shop and the rival's with price tags, a crate meter (one crate per week of cover, max 12), a blinking amber SOLD OUT tag, and an amber "arriving" stack. 60 pixel customers are split by `shares`. Switchers walk in whole pixels and flash `#FFB566`. "Same so far" shows when the two weeks are identical;
  - a story line: a `.px-bub` with the week's marker text and a `PixelFace` whose mood follows the sign of the week's gap;
  - the **week strip** (`WeekStrip`): one column per week of stacked square blocks, up in green and down in coral for that week's profit gap, with marker glyphs and click-to-seek;
  - a dashed end card with this run's gap and the 1,000-run average and "% beat doing nothing".
  - Numbers all come from the replay ticks and the grid cell. The supplier node is gone, replaced by chips (input cost vs week 0, lead time, rival price). The Analyst view tab uses the same paper panels and mono labels.
