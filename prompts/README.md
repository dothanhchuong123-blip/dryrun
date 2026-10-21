# START HERE: what to run, when, and who runs it

Each numbered folder is one **wave**. **Everything inside a folder can run at the same time**, unless the folder name says `in-order`. Tick the boxes here as tasks get committed.

## How to start a task

- **Claude task:**
  1. Open a **new Claude Code session** in this project folder.
  2. Pick the model shown in the task's header.
  3. Type the one line from the task's **Start** row, for example:
     `Do the task in prompts/1_oct15_all-parallel/T04-llm-router.md`

  Nothing to paste: the session reads the file and `CLAUDE.md` itself.
- **Argon (since Oct 15: reviews and advice only, no more builds):** follow `prompts/argon/HOW-TO.md` → "Run a review". Every build task from here on is a Claude prompt.

## The board

### Wave 1 · Oct 15 · `prompts/1_oct15_all-parallel/`. Start all 5 now.
| Done | Task | Builder | File |
|---|---|---|---|
| [x] | T01 market engine + baseline | Argon #1 → Claude check | `prompts/1_oct15_all-parallel/T01-engine-market.md` |
| [x] | T02 inventory, bullwhip, game theory | Argon #2 → Claude check | `prompts/1_oct15_all-parallel/T02-engine-inventory-game.md` |
| [x] | T10 frontend shell + mock stream | Argon #3 → Claude check | `prompts/1_oct15_all-parallel/T10-frontend-shell.md` |
| [x] | T04 Nemotron router, limiter, telemetry | Claude Sonnet 5.5 | `prompts/1_oct15_all-parallel/T04-llm-router.md` |
| [x] | T05 agent schemas + prompts | Claude Sonnet 5.5 (effort high) | `prompts/1_oct15_all-parallel/T05-agents-schemas-prompts.md` |

**Also today:** Argon review **A1** (spec math), on any account: `prompts/argon/reviews/A1-spec-math.md`

### Wave 2 · Oct 16–17 · `prompts/2_oct16-17_all-parallel/`. Start each one as soon as its inputs are committed.
| Done | Task | Builder | Needs | File |
|---|---|---|---|---|
| [x] | T03 stats + Monte Carlo | Argon #1 → Claude check | T01, T02 | `prompts/2_oct16-17_all-parallel/T03-stats-montecarlo.md` |
| [x] | T11 charts + news cards | Argon #3 → Claude check | T10 | `prompts/2_oct16-17_all-parallel/T11-frontend-terminal.md` |
| [x] | T12 canvas arena | Argon #2 → Claude check | T10 | `prompts/2_oct16-17_all-parallel/T12-frontend-arena.md` |
| [x] | T06 Tavily scout + scenarios | Claude Sonnet 5.5 | T04, T05 | `prompts/2_oct16-17_all-parallel/T06-tavily-scout.md` |

### UI exploration · Oct 15–16 · `prompts/ui_oct15-16_all-parallel/`. Runs alongside waves 1–3 (no code touched).
The brief is `docs/DESIGN.md`. There are five Argon mockups (one HTML file each, in `docs/mockups/`) and four perspective reviews. **No Claude check needed for the mockups.**

| Done | Job | Builder | When | File |
|---|---|---|---|---|
| [x] | A10 design references | Argon, any account | first, or alongside D1–D3 | `prompts/argon/reviews/A10-design-references.md` |
| [x] | A11 plain-English copy deck | Argon, any account | alongside | `prompts/argon/reviews/A11-plain-english-copy.md` |
| [x] | D1 Daylight (clean light) | Argon #1 | Oct 15 | `prompts/ui_oct15-16_all-parallel/D1-daylight.md` |
| [x] | D2 Night shift (calm dark) | Argon #2 | Oct 15 | `prompts/ui_oct15-16_all-parallel/D2-night-shift.md` |
| [x] | D3 Sim town (full pixel game) | Argon #3 | Oct 15 | `prompts/ui_oct15-16_all-parallel/D3-sim-town.md` |
| [x] | D4 Explainer (data journalism) | Argon #1 | after D1 | `prompts/ui_oct15-16_all-parallel/D4-explainer.md` |
| [x] | D5 Trading desk (dense pro dark) | Argon #2 | after D2 | `prompts/ui_oct15-16_all-parallel/D5-trading-desk.md` |
| [x] | A12 persona panel (5 viewers × 5 mockups) | Argon, any account | after D1–D5 | `prompts/argon/reviews/A12-persona-panel.md` |
| [x] | A13 shootout + final pick | Argon, a **different** account | after A12 | `prompts/argon/reviews/A13-design-shootout.md` |
| [x] | **You pick.** Claude fills in DESIGN.md §11 (D4 × D1, big arena + chart track, light only) | you + Claude | Oct 14 | `docs/DESIGN.md` §11 |
| [x] | D6 Final mockup (superseded by D7 after the pivot) | Argon, any account | alongside T07 | `prompts/ui_oct15-16_all-parallel/D6-final.md` |

## ⟳ Pivot v3 (decided Oct 14): "Test your plans"

The app now tests a user's own business plans against live news. The spec is **SPEC §15**, the screens are **DESIGN.md §12**, the contract is **EVENTS.md v2**, and the wireframes are `docs/PIVOT-PLAN.html`. Waves 1–2 stay: the engine, router, Tavily scout, arena and charts are all reused. The old T07 is retired (`prompts/_retired/`).

**v3.1 (Oct 15):** realism update (SPEC §15 v3.1, EVENTS v2.1, DESIGN §12.3a). **All remaining builds are Claude sessions.** Argon only reviews finished work or gives advice (A2–A9).

```
Oct 15–16   P1 ✓ · D7 ✓ · P2 ✓ ──┐   F0 frontend shell v2 (Claude Sonnet), alongside P2
Oct 16–17   P2b engine recalibration (Claude Opus) ◄┤   (from the Argon review; before any live run or recording)
Oct 17      P3 analyst loop + futures + news (Claude) ◄──────┘   F1 · F2 · F3 screens (3 Claude sessions, parallel, after F0)
Oct 18      P4 orchestrator + CLI (Claude Opus) = MILESTONE A    (F1–F3 finish)
Oct 19–20   T08 API v2 → T09 Nebius deploy = MILESTONE B
Oct 21–24   connect frontend ↔ backend, polish · Argon reviews A2 · A4 · A5 on the working app
```

### Wave 3 · Oct 15–16 · `prompts/3_oct15-16_pivot-parallel/`. P2 now (with F0 alongside).
| Done | Task | Builder | Needs | File |
|---|---|---|---|---|
| [x] | P1 pivot schemas, prompts, example businesses (+ native tool-call check) | Claude Sonnet 5.5 (effort high) | nothing | `prompts/3_oct15-16_pivot-parallel/P1-profile-schemas-prompts.md` |
| [x] | P2 engine planner: calibration, plans, grid, cell replay (+ v3.1 bridge, cash, rival split) | Claude **Opus 5.5** (effort high) | T01–T03 | `prompts/3_oct15-16_pivot-parallel/P2-engine-planner.md` |
| [x] | D7 pivot mockup, screens 1–6 (numbers to refresh for v3.1: optional Claude task) | Argon #2 → you approved | nothing | `prompts/3_oct15-16_pivot-parallel/D7-pivot-mockup.md` |

### Wave 3b · Oct 15–17 · `prompts/3b_oct17_one-task/` + F0
**Review (Oct 15):** Argon's wave 3 review was checked against the code: `docs/wrapups/wave3-argon-verdict.md`. The engine is too insensitive to price, so "Raise 5%" wins with no shock and cost-plus beats every plan. **P2b fixes this, and must land before P3's live run, P4's recordings and F0's mock numbers.** P3, P4 and F0–F3 each gained a "Review additions" section.

| Done | Task | Builder | Needs | File |
|---|---|---|---|---|
| [x] | **P2b engine recalibration**: price sensitivity, outside option, per-path uncertainty (SPEC §15.3 change approved 2026-10-15) | Claude **Opus 5.5** (effort high) | P2 | `prompts/3b_oct17_one-task/P2b-engine-recalibration.md` |
| [x] | P3 analyst loop, futures step, shopper reactions, news watch (offline part can run alongside P2b; **live run after P2b**) | Claude Sonnet 5.5 (effort high) | P1, P2 (+P2b for the live run) | `prompts/3b_oct17_one-task/P3-analyst-news.md` |
| [x] | F0 frontend shell v2: types, store, stream, mock, page shell | Claude Sonnet 5.5 (effort medium). **Can start now**, alongside P2 | EVENTS v2.1 | `prompts/ui_oct17-20_frontend/F0-frontend-shell-v2.md` |

### Wave 3c · Oct 18 · **Milestone A** (headless end-to-end analysis) · `prompts/3c_oct18_one-task/`
| Done | Task | Builder | Needs | File |
|---|---|---|---|---|
| [x] | P4 analysis orchestrator, cell replay, CLI, example recordings | Claude **Opus 5.5** (effort high) | P1–P3 | `prompts/3c_oct18_one-task/P4-analysis-orchestrator.md` |

Then (optional, advice only): Argon review **A2** (prompt red-team on the analyst, futures and profile prompts) and **A3** (whole repo).

### Frontend screens · Oct 17–20 · `prompts/ui_oct17-20_frontend/`. F1–F3 run in parallel (3 Claude sessions) after F0.
| Done | Task | Builder | File |
|---|---|---|---|
| [x] | F1 screens 1–2: your business, news | Claude Sonnet 5.5 (effort medium) | `prompts/ui_oct17-20_frontend/F1-setup-news.md` |
| [x] | F2 screens 3–4: analyst log, plans × futures grid | Claude Sonnet 5.5 (effort medium) | `prompts/ui_oct17-20_frontend/F2-analyst-grid.md` |
| [x] | F3 screens 5–6: replay drawer (arena), decision memo | Claude Sonnet 5.5 (effort medium) | `prompts/ui_oct17-20_frontend/F3-replay-memo.md` |

### Wave 4 · Oct 19–20 · **Milestone B** (deployed) · `prompts/4_oct19-20_in-order/`. **T08 first, then T09.**
| Done | Task | Builder | File |
|---|---|---|---|
| [x] | T08 API v2, SSE, replay, spend guard | Claude Sonnet 5.5 | `prompts/4_oct19-20_in-order/T08-api-sse-replay.md` |
| [x] | T09 Nebius Endpoint + 10,000-per-cell Job | Claude Sonnet 5.5 **+ you** (console, billing) | `prompts/4_oct19-20_in-order/T09-nebius-deploy.md` |
| | **CHECKPOINT (2026-10-15), T09 paused for UI/UX work** | | **Done and pushed:** job service (`backend/services/nebius_jobs.py`, local + Nebius backends, tested), multi-stage `Dockerfile`, `jobs/mc_worker/Dockerfile`, `render.yaml`, `scripts/bench_serverless.py`, `docs/DEPLOY.md`. Public repo: github.com/dothanhchuong123-blip/market-digital-twin. **Decisions:** no Nebius compute (projects suspended until a $25 top-up; 24/7 CPU ≈ $90-195) and no Hugging Face (Docker Spaces need PRO), so the public demo goes on **Render free**. Nebius CLI + Docker are installed and logged in. **Still to do:** (1) after the UI work, connect the repo in Render (New → Blueprint), add `NEBIUS_API_KEY` + `TAVILY_API_KEY`; (2) test the URL (`/health`, SSE) and add an uptime ping; (3) optional: top up Nebius, run `scripts/bench_serverless.py` for the feedback report; (4) tick T09 when 1-2 are done. |

### Backtest · Oct 22–24 · `prompts/oct22-24_backtest/`. Two sessions, run in order: **B1a first, then B1b.** The contract changes were approved on 2026-10-21.
| Done | Task | Builder | Start |
|---|---|---|---|
| [x] | B1a backtest backend: engine knobs, 4 cases, as-of news, scoring, recordings | Claude Sonnet 5.5 (effort high) | `Do Parts A–C (B1a) of prompts/oct22-24_backtest/B1-backtest.md` |
| [ ] | B1b backtest frontend: real-case cards, "What actually happened" reveal | Claude Sonnet 5.5 (effort medium) | `Do Part D (B1b) of prompts/oct22-24_backtest/B1-backtest.md` |

### Oct 21–24 · connect, polish, review (no new prompt files)
- Point the frontend at the deployed backend (`NEXT_PUBLIC_API_BASE`) and fix whatever the real stream shows that the mock didn't.
- Run a LIVE analysis on a business you type in yourself. Is the memo something an owner would act on?
- P1 items from SPEC §15.10: Nash in the analyst tab, the Ultra rival in LIVE replays.
- Argon reviews **A5** (UI, on the real app) and **A4** (calibration: do the example businesses' numbers look believable?).

### Wave 5 · Oct 25–26 · `prompts/5_oct25-26_one-task/`
| Done | Task | Builder | File |
|---|---|---|---|
| [ ] | T13 benchmark + FEEDBACK.md | Claude Sonnet 5.5 | `prompts/5_oct25-26_one-task/T13-benchmark-feedback.md` |

Also: **A3** again (before the freeze), plus A6 and A7.

### Oct 27 · **feature freeze 23:59** · re-record the 3 example analyses (`python -m backend.sim.cli --example <id> --record`)

### Wave 6 · Oct 28–29 · `prompts/6_oct28-29_one-task/`
| Done | Task | Builder | File |
|---|---|---|---|
| [ ] | T14 README, video script (coffee roaster story), Devpost text, QA | Claude Sonnet 5.5 **+ you** | `prompts/6_oct28-29_one-task/T14-submission.md` |

Also: **A8** video critique (Oct 28) and **A9** judge simulation (Oct 29). Form answers come from `docs/SUBMISSION.md`.

### **Submit by Fri Oct 30, 12:00 GMT+7.** The hard deadline is Oct 31, 00:00 GMT+7.

## Who builds what, and why

| Builder | Tasks | Why |
|---|---|---|
| **Claude Sonnet 5.5** | T04–T06, P1, **P3, F0–F3**, T08, T09, T13, T14 | Every remaining build. Claude can run the tests, the dev server and the browser, so there's no copy-paste-import loop. |
| **Claude Opus 5.5** | **P2, P4**, plus acting on A3 | P2 is the math-heavy core; P4 is integration and needs the whole repo at once. |
| **Gemini 4 Argon** (3 Pro accounts) | **Reviews and advice only** (A2–A9), on finished work, usually near the end. It built T01–T03, T10–T12 and D1–D7 earlier. | A free second opinion that costs no Claude quota. Argon's findings are advice: a Claude session decides what to act on. |
| **Claude Haiku 5.5** | small doc fixes | Cheapest option. |

## Rules for every Claude session (these keep quota down and parallel work safe)
- **One task per session.** Start a fresh session for each task; don't continue a long chat.
- **Read only what the task names.** Don't explore the repo.
- **Stay inside the task's files.** If `backend/engine/types.py`, `docs/EVENTS.md` or `backend/config.py` needs a change, stop and ask. These are shared contracts.
- **Parallel sessions share this folder.**
  - Run only your own test file until the end.
  - Commit only your own files (`git add <files>`).
  - If git says `index.lock` exists, wait a few seconds and retry.
- **No live LLM or Tavily calls in tests.** Use mocks. Live calls happen only when a task says so, and they count against the $25 budget.
- **Log problems as you hit them** in `docs/FEEDBACK_LOG.md`.
- **Commit format:** `Txx: <summary>`.
- **Ask the user** before any action estimated at more than $1.
