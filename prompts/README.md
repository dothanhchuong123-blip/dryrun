# START HERE: what to run, when, and who runs it

Each numbered folder is one **wave**. **Everything inside a folder can run at the same time**, unless the folder name says `in-order`. Tick the boxes here as tasks get committed.

## How to start a task

- **Claude task:**
  1. Open a **new Claude Code session** in this project folder.
  2. Pick the model shown in the task's header.
  3. Type the one line from the task's **Start** row, for example:
     `Do the task in prompts/1_oct15_all-parallel/T04-llm-router.md`

  Nothing to paste: the session reads the file and `CLAUDE.md` itself.
- **Argon task:** follow `prompts/argon/HOW-TO.md` → "Build a task". It takes five steps: pack → upload + paste → copy the answer → import → Claude check.

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

### Wave 3 · Oct 18 · Milestone A (headless run) · `prompts/3_oct18_one-task/`
| Done | Task | Builder | Needs | File |
|---|---|---|---|---|
| [ ] | T07 orchestrator + headless CLI | Claude **Opus 5.5** (effort high) | all of waves 1–2 | `prompts/3_oct18_one-task/T07-orchestrator-headless.md` |

Then: Argon review **A3** (whole repo), `prompts/argon/reviews/A3-repo-review.md`.

### Wave 4 · Oct 19–20 · Milestone B (deployed) · `prompts/4_oct19-20_in-order/`. **T08 first, then T09.**
| Done | Task | Builder | File |
|---|---|---|---|
| [ ] | T08 API, SSE, replay, spend guard | Claude Sonnet 5.5 | `prompts/4_oct19-20_in-order/T08-api-sse-replay.md` |
| [ ] | T09 Nebius Endpoint + Job | Claude Sonnet 5.5 **+ you** (console, billing) | `prompts/4_oct19-20_in-order/T09-nebius-deploy.md` |

### Oct 21–24 · buffer and polish (no new prompt files)
- Connect the frontend to the live backend.
- **UI restyle (deferred from T10 check, Oct 14).** The T10 shell works but looks like a debug console: boxes inside boxes, monospace everywhere, too many coloured outlines, internal labels ("T12 CANVAS SLOT") showing, weak headline numbers, cramped 3-row header. Write `docs/DESIGN.md` (fonts, surfaces, type scale, colour meaning, number format), then restyle `tailwind.config.ts`, `globals.css`, `app/page.tsx`, and bring T11/T12 in line. Do it before A5.
- Scenarios 2–3.
- P1 items from SPEC §11.
- Argon reviews **A5** (UI) and **A4** (calibration).
- Fix whatever comes up.

The frontend was finished early by Argon, so these four days are slack.

### Wave 5 · Oct 25–26 · `prompts/5_oct25-26_one-task/`
| Done | Task | Builder | File |
|---|---|---|---|
| [ ] | T13 benchmark + FEEDBACK.md | Claude Sonnet 5.5 | `prompts/5_oct25-26_one-task/T13-benchmark-feedback.md` |

Also: **A3** again (before the freeze), plus A6 and A7.

### Oct 27 · **feature freeze 23:59** · record the replays

### Wave 6 · Oct 28–29 · `prompts/6_oct28-29_one-task/`
| Done | Task | Builder | File |
|---|---|---|---|
| [ ] | T14 README, video script, Devpost text, QA | Claude Sonnet 5.5 **+ you** | `prompts/6_oct28-29_one-task/T14-submission.md` |

Also: **A8** video critique (Oct 28) and **A9** judge simulation (Oct 29). Form answers come from `docs/SUBMISSION.md`.

### **Submit by Fri Oct 30, 12:00 GMT+7.** The hard deadline is Oct 31, 00:00 GMT+7.

## Who builds what, and why

| Builder | Tasks | Why |
|---|---|---|
| **Gemini 4 Argon** (3 Pro accounts) | T01, T02, T03, T10, T11, T12 + reviews A1–A9 | Pure code built against written contracts, with no keys or live calls, so tests or a build can check it. Uses no Claude quota. |
| **Claude Sonnet 5.5** | T04, T05, T06, T08, T09, T13, T14 + every Argon check | These need API keys or live Nemotron/Tavily calls, the Nebius console, or your judgement. |
| **Claude Opus 5.5** | T07, plus checking A3 | Integration: it needs the whole repo at once. |
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
