# Devpost submission: every form field, with its source and owner

This file mirrors the real Devpost form (copied from the site on 2026-10-14). T14 turns it into final text in `docs/DEVPOST.md`, and then you paste that into Devpost.

**Status keys:**
- ✅ final
- ✏️ drafted here, polish in T14
- ⏳ waiting on data from a task
- 👤 your call: a personal answer or rating

## I. Project overview

| # | Field | Status | Answer / source |
|---|---|---|---|
| 1 | **Project name*** | ✅ | **Dry Run** (picked 2026-10-20; was "Market Twin"). |
| 2 | **Elevator pitch*** | ✏️ | See below. Devpost limits taglines to about 200 characters. |

Elevator pitch draft (175 characters, v3):
> Describe your business. Tavily finds the news that hits it, Nemotron proposes plans, and a simulator tests every plan in several futures. You get a decision memo with sources.

## II. Project details (public page)

| # | Field | Status | Answer / source |
|---|---|---|---|
| 1 | **About the project*** | ⏳ T14 | One Markdown story. Its outline is below. |
| 2 | Built with (≤ 25 tags) | ✏️ | See the tag list below. |
| 3 | "Try it out" links | ⏳ | The GitHub repo URL, and the live demo URL from T09. |
| 4 | Image gallery | ⏳ T14 | 6 PNGs, 1800×1200 (3:2), each < 5 MB, saved in `docs/media/`. Shot list below. |
| 5 | **Demo video URL*** | ⏳ Oct 28 | YouTube or Vimeo, set to **public or unlisted** with no password. Only the first 3:00 is reviewed, so we aim for 2:45 (`docs/VIDEO_SCRIPT.md`). |

**About the project.** Use these headings in this order:
1. Inspiration
2. What it does
3. How we built it. Include the architecture and **one LaTeX equation**: the MNL choice probability from SPEC §4.1 in `$$…$$`.
4. Challenges. Use real ones from `docs/FEEDBACK_LOG.md`.
5. What we learned
6. What's next

The form has **no separate testing field**, so put a two-line "How to try it" at the end of the story as well as in the README.

**Built with** (24 tags; leave one spare slot):
- **NVIDIA:** `nvidia-nemotron`, `nemotron-3-ultra`, `nemotron-3-super`, `nemotron-3.5-lightning`, `nemotron-3-nano`
- **Nebius and Tavily:** `nebius-token-factory`, `nebius-serverless`, `tavily`
- **Backend:** `python`, `fastapi`, `pydantic`, `numpy`, `scipy`, `nashpy`, `openai-sdk`, `server-sent-events`
- **Frontend:** `next.js`, `react`, `typescript`, `tailwindcss`, `zustand`, `html5-canvas`
- **Methods:** `monte-carlo`, `game-theory`

**Gallery shot list (v3).** Image 1 is the thumbnail, so make it the most striking.
1. Hero: the landing page with the pixel shop, the rival and the 200 pixel customers
2. "Every plan in every future": the plans × futures grid, with the news column and the recommended plan marked
3. The answer page: the decision memo with its Tavily source lines (outlet, date, link) and the open "How we searched" panel
4. The analyst log: "Nemotron asked Tavily: …", the new "Searched" column and Ultra's reasoning next to the plan it produced
5. The backtest reveal: what the memo said, then what really happened, with the miss shown
6. The architecture diagram: Tavily and Token Factory in, the NumPy engine in the middle, the Serverless Job and Endpoint on Nebius

## III. Additional info (judges only)

| # | Field | Status | Answer / source |
|---|---|---|---|
| 1 | Upload a file | optional | Only if there's time: a PDF of `docs/FEEDBACK.md` with the benchmark charts. |
| 2 | **Submitter type*** | ✅ | Individual |
| 3 | **Organization*** | ✅ | N/A |
| | **Country*** | ✅ | Vietnam |
| 4 | **Track*** | ✅ | Best Apps and Agents |
| 5 | New or existing before Aug 26, 2026 | ✅ | **New.** The repo history starts on 2026-10-14. |
| 6 | If existing, what changed | ✅ | N/A |
| 7 | **Public repo URL*** | ⏳ | Must have an OSI license (MIT at the repo root ✅) and a README with setup. The README must also show **how we use Nemotron**, **where Token Factory sped up our workflow** and **which other Nebius services we use**. T14 writes it. |
| 8 | Working demo URL | ⏳ T09 | The Nebius Serverless Endpoint URL, or the Vercel fallback for the frontend. |
| 9 | **Model(s) used and why that size*** | ✏️ | Draft below |
| 10 | **Nemotron output quality, 1–10*** | 👤 | Your number. Evidence: `docs/FEEDBACK.md` (schema-valid rate, the out-of-enum case, how good the reasoning was). |
| 11 | **Fine-tuned, prompt-engineered or out of the box?*** | ✏️ | Draft below |
| 12 | **Compared with other models*** | ⏳ T13 | Measured: one non-Nemotron model on Token Factory, same CEO prompt (T13). Qualitative: the Gemini 4 Argon side-by-side (`prompts/argon/reviews/A7-nemotron-vs-argon.md`). **Claim only what we measured.** |
| 13 | **Most valuable Nebius capabilities*** | ✏️ + ⏳ T09 | Draft below. Add the Endpoint preset and cold-start numbers after T09. |
| 14 | **Would you recommend Nemotron on Nebius, 1–10*** | 👤 | Your number, plus the top 2 reasons from FEEDBACK.md. |
| 15 | **Experience vs your previous cloud/local setup, 1–10*** | 👤 | Your number. Compare against whatever you've used before. |
| 16 | **Improvements that would have helped*** | ⏳ T13 | The top items from `docs/FEEDBACK_LOG.md`, each with its evidence. |
| 17 | What you hope to see next from the Nemotron team | ✏️ 👤 | Draft below |
| 18 | Did you use Tavily? | ✅ | **Yes**, at runtime in every analysis, and a judge can trigger it live. Search (news, and local-market with `country`), Extract, and Map for pasted shop links; **Nemotron Ultra can also ask Tavily a question mid-analysis** and the answer becomes a new future that every plan is tested in. The **"Check live news"** button works in REPLAY too. See "How we use Tavily" below. |
| 19 | Builders & Brews IRL city | 👤 | Pick a city only if you attend one of those events. Otherwise leave it blank. |
| 20 | **AI tools used*** | ✏️ | Draft below. Keep it updated as you go. |
| 21 | **Level of learning*** | 👤 | Your words. Jot notes at the bottom of this file while building. |
| 22 | **AI value you can use in your career*** | 👤 | Your words. Same notes. |

### Drafts (T14 polishes these; every number must come from `bench/results/`)

**Q9, models and why:**
- **Nemotron 3 Ultra (550B-A55B), thinking on: the two CEO agents.**
  - They make strategic pricing, production and marketing calls once per decision epoch, where deep reasoning is worth the latency.
  - Its reasoning streams live in the UI.
  - Measured: answer ready ≈ 8.5 s with thinking on, about 340 tok/s.
- **Nemotron 3 Super (120B-A12B), thinking off: shock parser and inventory risk factor.**
  - These are structured extraction tasks under a strict JSON schema.
  - Measured: 1.16 s TTFT, 168 tok/s, at about a third of Ultra's price.
- **Nemotron 3.5 Lightning: the 12-archetype consumer crowd.**
  - Many small calls, where latency and price matter most.
  - Measured: 0.94 s TTFT, 198 tok/s, 600 RPM limit.
- **Nemotron 3 Nano (30B-A3B):** the crowd's fallback and a benchmark point. Its 5.2 s TTFT, measured, is why Lightning is the primary.

**Q11, approach:**
- Out of the box plus prompt engineering. No fine-tuning.
- Every call uses strict `json_schema` with Pydantic validation, then the values are clamped.
- Thinking is toggled per tier through `chat_template_kwargs`.
- Ultra ignores `reasoning_budget` and `reasoning_effort`, so we cap reasoning length with prompt wording and `max_tokens`.
- Each call retries once, then falls back to a deterministic rule.
- The LLMs output decisions only. The NumPy engine computes every outcome.

**Q13, Nebius capabilities:**
- **Token Factory's OpenAI-compatible API:** one key and one client reach all four Nemotron tiers. Swapping a model is just an env var, which made the tier benchmark cheap.
- **Per-model rate-limit headers:** let us run a ≈ 45 RPM multi-agent loop safely.
- **Serverless Endpoint:** hosts the FastAPI and SSE app.
- **Serverless Job:** runs the 10,000-path Monte Carlo.
- **No GPU instances to manage:** all inference is served by Token Factory.
- *(after T09: the preset, the cost to stay up until Dec 15, and cold-start times)*

**Q17, hopes (draft from the friction log):**
- Reasoning-budget control that actually works on Ultra through the API.
- Consistent casing in model IDs.
- A model card and pricing row for Lightning on Token Factory.

**Q20, AI tools:**
- Claude Code (Opus 5.5, Sonnet 5.5, Haiku 5.5): coding and planning
- Gemini 4 Argon in the Gemini app: reviews and video critique
- NVIDIA Nemotron via Token Factory: in the product
- Tavily: in the product, and research through MCP

## How we use Tavily (for the Best Use of Tavily prize and Q18)

**What it does for the product.** Tavily is how an owner's plan meets today's world. We turn what a user says about their business into search queries, read the articles that come back, and turn each article's own words into numbers the simulator can use (how much the main input costs more, how much later it arrives, how demand moves). Every number the engine uses carries a quote that was found word for word on the page, and the memo links the article. Nothing Tavily returns reaches the engine without that check.

**Where it is called (all at runtime, in `backend/services/`):**

| Step | Tavily call | Parameters we send |
|---|---|---|
| Supply news for the business | `search` | `search_depth: basic`, `topic: news`, `time_range: week`, `max_results: 5`, `include_favicon`, `include_usage` |
| Local market (rivals, new chains, demand) | `search` | `topic: general`, `country` from the profile, `time_range: month`, `language` when the query is not English, `exact_match` when a rival name is quoted (retried without it if it finds nothing) |
| Read the top 3 articles | `extract` | `extract_depth: basic`, `format: text`, `query` (reranks to the part about our topic), `include_usage` |
| A backtest (a past date) | `search` | `start_date` / `end_date` instead of `time_range`: the window is what keeps each case blind to later news |
| "Check live news" button | `search` + `extract`, cache bypassed | the same as above, one article |
| **Nemotron's own question** (new 2026-10-24) | `search` + `extract` | `basic`, at most 1 a round and 2 an analysis, cached, counted against the daily cap |
| A pasted shop link | `extract`, then `map` + `extract` if the page is thin | `map`: `max_depth 1`, `limit 10`, `select_paths` for menu/price/shop pages; at most 3 credits a link |

We have not used Crawl or Research. Every response is cached under `fixtures/tavily_cache/` (47 search and 25 extract responses so far), so the recorded demo replays with no Tavily call at all.

**What the answer page shows.** Each source line reads "Tavily · outlet · date · open article" with the outlet's favicon, and a "How we searched" panel lists every query with its parameters, the credits it cost, how many results came back, how many were dropped and why, and how many were read.

**Numbers from our own logs** (re-counted offline from the cache on 2026-10-24, over the 4 example analyses and 10 backtest cases; `scripts/backfill_search_log.py`):

| Measure | Value |
|---|---|
| Tavily credits per analysis (Search + Extract) | **3.6 on average** (50 credits over 14 recorded analyses; 3 to 5 each); up to 4 more if Nemotron asks 2 questions |
| Results returned / kept | 144 / 117 |
| Results dropped before any article was read | **27 of 144 (18.8%)**: 12 social posts, 15 dated outside a backtest's window; 0 index or sitemap pages and 0 too-short snippets in these recordings |
| Articles read in full (Extract) | 37 |
| Articles that gave a usable, verified number | **24 of 37 (65%)** (the rest said nothing about costs, contradicted their own quote or were already old news) |
| Quote check (found word for word on the page) | counted from the first LIVE runs since 2026-10-24 (`news.searched.quotes`): ___ of ___ <!-- fill from the next live run, do not guess --> |
| Public "Check live news" button, on the live site | answered in 11 s, 2 credits (found an off-topic article; now skipped when it moves nothing) |
| Real credits (`include_usage`) | search 1, 1-URL extract 1, a 9-page map 0 |

Budget: the free plan (1,000 credits a month) is shared by the public demo and our own research. The public button and the shop-link reader share a daily cap of 30 credits (`TAVILY_DAILY_CREDIT_CAP`).

## Gaps the form exposed (already added to the plan)

- **README must say where Token Factory sped up our workflow.** Added to T14.
- **Tavily needs a runtime call that judges can trigger, even in REPLAY.** Added the "Check live news" button: SPEC §6, EVENTS.md, T08, T11.
- **Q12 needs a comparison with a non-Nemotron model.** Added to T13.
- **Feedback questions are required, and the prize rewards specific evidence.** Every session now logs problems as they hit them in `docs/FEEDBACK_LOG.md`.
- **The form has no testing-instructions field.** T14 adds a "For judges" section to the README and a short "How to try it" to the About story.

## Learning notes for Q21–22 (yours; add a line whenever something clicks)

-
