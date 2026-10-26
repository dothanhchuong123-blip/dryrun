# Demo video script: Dry Run (target 2:45)

Judges watch only the first 3:00. Everything that matters happens before 2:45.

**One message, said twice:** Nemotron decides, the math proves it.

**Source:** the Austin coffee roaster example (`fixtures/replays/analysis_coffee_austin.jsonl`, re-recorded 2026-10-26). Every label and number below is what that recording shows on screen. If the example is re-recorded again (the Oct 27 freeze), walk through it again and update the numbers here before filming.

## Before you record

- Warm the site first: open https://dryrun-1hny.onrender.com/health and wait for `200`. A cold start takes about 30 s.
- Use **light mode**, a 1440×900 browser window, zoom 100%, and no extensions in view.
- Turn **Auto-continue** on (top right) so the steps move on by themselves.
- Play the example from a recording. It is free, and the same every time. The whole run takes about 80 s, so speed Act 3 up 2× in the edit.
- Optional B-roll: type your own line into the box on the public site (a LIVE run, about $0.05). Use it only for the 3-second typing shot, never for the numbers.

## Script

| Time | On screen | Voice-over |
|---|---|---|
| **Act 1: The problem** | | |
| 0:00–0:08 | Front page. Headline: "Try your plan on 200 customers before you try it on real ones." | "You run a small coffee roaster in Austin. Your gut says: raise prices 8%. But what if you're wrong?" |
| 0:08–0:18 | Scroll to the example cards. Hover "Coffee roaster in Austin, Texas", then click **Run this example →**. | "Dry Run tests your plan before your customers do. Describe your business in one line, or pick an example." |
| **Act 2: Tavily finds the news** | | |
| 0:18–0:28 | Profile card: Lone Star Roasting · $13.00 → $7.80 · 300 a week · rival Capital City Coffee at $12.50. | "Nemotron Super turns one line into a business: price, cost and the rival down the street." |
| 0:28–0:45 | "Read 7 articles": the four Tavily queries ("tariff Brazil coffee imports US roasters", "arabica coffee futures price record"…). Zoom in on the source cards (vietnam.vn, comunicaffe.com) and the yellow cost line: "Beans +30% × 60% of your cost is beans = your cost +18%". "If you do nothing: −$3.4k". | "Tavily searches and reads the news in your market, and every quote can be checked word for word. Arabica is at a one-month high. We test a 30% bean-cost shock. Doing nothing costs you $3,400 over six months." |
| 0:45–0:55 | "Futures to test": six columns with source chips. Beans +10%, Beans +40% with demand slipping, Capital City cuts 8%, Two new cafés steal 12%, Bean scare fades −5%. | "Nemotron Ultra reads those articles and picks the futures your plan must survive, including a rival price war and the scare fading." |
| **Act 3: Ultra proposes, the simulator tests** (speed up 2×) | | |
| 0:55–1:15 | Test plans view. Left: the analyst's rounds ("Round 2 of 3"). Middle: 12 pixel shoppers. Hover one bubble: "Firm A is reliable, but 3% hurts my pension." Right: the 1,000-run histogram. | "Ultra proposes plans. Twelve kinds of customer, each played by Nemotron Lightning, react to every price change. The simulator runs each plan 1,000 times in every future." |
| 1:15–1:35 | Simulator on **Your gut call: Raise price 8% now** in "Bean scare fades": better than doing nothing in only 22 of 100 runs, with 1 in 20 worse than −$5.3k. | "Your gut call looks great today. But if the bean scare fades, 1 run in 20 loses more than $5,300." |
| 1:35–1:50 | Round 3 note from Ultra: "The best plan so far is 'Stock up 4 weeks now' – it has the mildest bad-case loss… The owner's gut call (+8% price) has a dangerous -5.3k bad case." | "Ultra reads the results and changes its mind. Nemotron decides; the math proves it." |
| 1:50–2:00 | The grid fills in: "Every plan in every future", 48,000 runs. Bottom bar: "Tested 8 plans in 6 futures · Best plan: Stock up 4 weeks now · +$1.4k vs doing nothing". | "Eight plans, six futures, 48,000 simulated runs." |
| **Act 4: The answer** | | |
| 2:00–2:15 | Memo: "Stock up 4 weeks now to lock in current bean costs before prices climb further", +$1.4k, HIGH CONFIDENCE · 1,000 RUNS. Tiles: bad case +$898; cash tied up $9.4k of $12k. | "The answer: stock up four weeks of beans now. Plus $1,400, still ahead even in a bad run, and you keep enough cash." |
| 2:15–2:22 | "One run, two futures": the pixel shops side by side, then click **Watch full run ▸**. | (no voice: let the shops play) |
| 2:22–2:30 | Front page backtest: "Right in 7 of 9". Show one "Right" row and the Malaysian palm-oil "Missed" ($54). | "We also checked it on nine real cases from 2022 to 2025, with only the news known on the day. Right in seven, and we show the misses." |
| **Act 5: How it's built** | | |
| 2:30–2:45 | One architecture card: Nemotron Ultra (analyst, thinking on) · Super (parser) · Lightning (12 shoppers) on Nebius Token Factory → NumPy simulator → memo; Tavily Search + Extract + Map. Memo footer: "31 AI calls, $0.04." | "Three Nemotron models on Nebius Token Factory, live news from Tavily, and a simulator that does every bit of the math. This whole analysis cost four cents. Dry Run: test your plans first." |

## Facts to keep straight

- **The +30% bean shock is our test scenario, not a news report.** The page labels it "Example scenario, set by us". Say "we test a 30% shock", never "tariffs pushed beans up 30%". The real Tavily news is Arabica at a one-month high (+3.3%).
- The numbers come from the simulator, never from the AI. Don't say "Nemotron predicts +$1.4k".
- Don't claim a Nebius Serverless Job or Endpoint. The public demo runs on Render. Nebius is Token Factory inference.
- Cost: this recording made 31 calls (4 Ultra, 3 Super, 24 Lightning) for $0.038. Running every call on Ultra would have cost $0.067.

## Open before filming

- The example card says "tariffs on Brazilian beans are in the news", and that overstates it. Reword it to match the label, or keep it off screen.
- The memo says cash comes back "by week 14" on the tile but "Week 13" in What to do. That's small, but someone will notice it in a frame-by-frame.
- The memo's runner-up line compares against the gut call only in today's news column, so it doesn't mention the −$5.3k case. The video's voice-over covers that.
