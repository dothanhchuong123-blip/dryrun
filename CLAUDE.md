# Project memory: Market Digital Twin (Nebius x NVIDIA Global AI Hackathon)

**Read this first, then follow `SPEC.md`. SPEC.md is the source of truth and replaces the original v1 research prompt.** Every Claude session working on this project should read both files.

## Snapshot
- **What (pivot v3, 2026-10-14):** "Test your plans." A user describes their business, Tavily finds the news that hits it, and a **Nemotron Ultra analyst** proposes plans that a deterministic NumPy engine tests against 4 shock levels (plans × shocks grid, scored against "Do nothing"). The result is a decision memo. Nemotron makes the *decisions* (plans, shopper reactions, shock numbers); the engine computes every *outcome*. **SPEC §15 is the spec for this; read it first.** Screens: `docs/DESIGN.md` §12. Wireframes: `docs/PIVOT-PLAN.html`.
- **Track:** Best Apps and Agents. **Also aiming for:** Best Use of Tavily ($3k) and Most Valuable Feedback.
- **Hard deadline:** Fri **Oct 30 2026, 10:00 PDT** = **Sat Oct 31, 00:00 GMT+7**. **We submit by Fri Oct 30, 12:00 GMT+7.**
- **Judging:** Dec 1–15, 2026. **The live demo must stay up, free and working until Dec 15.**
- **Milestones:** A, headless end-to-end, by Oct 18. B, deployed on Nebius with the MC job running, by Oct 20. Feature freeze Oct 27.

## Locked decisions (don't re-litigate)
1. **Model inference goes through the Nebius Token Factory API (OpenAI-compatible).** Nebius **Serverless Endpoint** hosts *our app*; Nebius **Serverless Job** runs the 10k-path Monte Carlo. We never self-host Ultra.
2. **Model tiers:**
   - Ultra (`MODEL_ULTRA`) is the CEO, with thinking ON.
   - Super (`MODEL_SUPER`) is the shock parser and inventory ω, with thinking OFF.
   - The fast tier (`MODEL_FAST`) is the crowd: **Nemotron 3.5 Lightning**, which is confirmed on Token Factory. Nano 3 is the fallback and the benchmark comparison. Thinking OFF.
   - **Model IDs and the base URL come from env vars. Never hardcode them.** The verified IDs are case-sensitive; see SPEC §3.3.
3. **Analysis loop (SPEC §15.6), replacing the old two-speed loop:**
   - Ultra runs up to 3 rounds of strict-JSON `AnalystStep` actions. Each round, the engine tests the plans Ultra proposes.
   - The engine is pure NumPy: 1,000 paths per cell locally, 10,000 on the Serverless Job.
   - The UI never waits on an LLM to show engine results.
4. **Target ≈ 45 RPM in total.** Per-model limits are 300–600 RPM, and Ultra's binding limit is 200k TPM. A per-model limiter reads the `x-ratelimit-*` headers and honours 429 `Retry-After`. Crowd calls are dropped first.
5. **No LLM calls inside the Monte Carlo.** The planner replays fixed plans and fixed crowd sentiment. Every plan and "Do nothing" share common random numbers.
6. **Every telemetry number is computed from real call logs.** Never show a hardcoded routing split or savings figure.
7. **REPLAY mode is the public default.** LIVE mode is rate-limited and has a daily spend cap.
8. **Stack:** Python 3.11+, FastAPI + SSE, Pydantic v2, NumPy/SciPy/nashpy · Next.js + Tailwind + Zustand + HTML5 Canvas · MIT license.

## Where things are
- **Work is split into task prompts** in `prompts/`, one folder per wave (T01–T14; pivot tasks P1–P4, D7, F0–F3). **`prompts/README.md` is the board**: what to run, when, who builds it, and what runs in parallel. If you were given a task, do only that task.
- **Shared contracts. Change them only with the user's OK:**
  - `backend/engine/types.py` (engine types)
  - `docs/EVENTS.md` (backend ↔ frontend SSE/REST, **v2** since the pivot)
  - SPEC §15.3–15.5 (profile, plan and shock-case fields)
  - SPEC §4.7 (tick order)
- **Submission:** `docs/SUBMISSION.md` maps every Devpost form field to its source and owner.
- **Feedback log:** hit a Nemotron, Token Factory, Nebius or Tavily quirk (or something that worked really well)? **Add one row to `docs/FEEDBACK_LOG.md` right away**, with evidence. It feeds the required feedback answers and the feedback prize (10 × $100).
- **Gemini 4 Argon** (Gemini app, 3 Pro accounts, no repo access) builds T01, T02, T03, T10, T11 and T12, and runs reviews A1–A9. Step-by-step guide: `prompts/argon/HOW-TO.md`. Argon code goes through `uv run scripts/argon.py pack|import <ID>`, and a Claude session must check it (`prompts/argon/check-build.md`) before it's committed.
- **Config:** read keys, model IDs and the base URL only via `backend.config.get_settings()`. Keys are `SecretStr`.
- **Dev commands:** `uv sync` · `uv run pytest -q` · `uv run ruff check backend tests` · `uv run uvicorn backend.main:app --reload`

## Guardrails for coding agents
- LLMs output **decisions only** (P, Q, M, ω, sentiment μ/σ, shock vector). Revenue, demand, profit and stats always come from `backend/engine/`.
- Every LLM call:
  - uses strict `json_schema` with Pydantic validation and clamps the result;
  - retries once, then uses the tier's deterministic fallback;
  - has its own per-tier timeout (Ultra 30 s, Super 10 s, fast tier 5 s).
- Ultra's reasoning streams in `delta.reasoning_content`; `content` is clean JSON.
- The engine is pure, seeded and unit-tested. No I/O in `engine/`.
- Never put keys in the repo. Use `.env` (gitignored) and `.env.example` for placeholders.
- Cache every Tavily response under `fixtures/tavily_cache/`.
- Arena sprite positions live in refs/typed arrays, never React state. UI state updates once per tick.
- Respect the P0/P1/P2 cut line in SPEC §11. When short on time, ship P0 well rather than P1 badly.

## Budget and keys (SPEC §7.1)
- **Token Factory: $25 total.** There may be another $25 from Nebius's promo programme, but that isn't confirmed.
  - One 3-minute LIVE run costs about $0.33. Keep $10 in reserve for judges' LIVE use (Oct 30–Dec 15).
  - **Ask the user before any single action estimated at more than $1.**
  - Day-1 script hard cap: $0.25.
- **Tavily: free plan, 1,000 credits/month.** The public "Check live news" button is capped by `TAVILY_DAILY_CREDIT_CAP` (30/day). Claude's Tavily MCP research uses the same pool, so stick to `basic` depth and only search when it's needed. The app caches every response.
- **Keys:**
  - Keys live only in `.env` (chmod 600, gitignored).
  - Read keys from the environment in code. **Never print, echo, `cat` or `grep` `.env`**, and never write a key into any other file, log or commit.
  - To check a key exists, print only its length.

## Open items (SPEC §13, Day-1 checklist). Update this list as they get resolved.
- [x] Day-1 Token Factory check done on 2026-10-14 for $0.008. Covered model IDs, base URL, thinking toggle, reasoning field, Ultra latency (K = 8) and rate limits. Results are in SPEC §3 and §5.
- [x] Ultra ignores `reasoning_budget` and `reasoning_effort`. Control reasoning length through the prompt and `max_tokens` (SPEC §13).
- [ ] Serverless Endpoint: CPU preset? cost to keep it up to Dec 15? does SSE work through it? cold starts?
- [x] Token Factory prices verified · Tavily connected (free plan, 1,000 credits/month)
- [x] Devpost rules and form confirmed by the user on 2026-10-14: 10 × $100 feedback prizes; Serverless Endpoints and Jobs are encouraged but **not required**. See `docs/SUBMISSION.md`.

## Housekeeping
- The project folder is `/Users/dochuong/Nebia x Nvidia`. It was renamed on 2026-10-14 to drop a trailing space, but the name still contains spaces, so always quote paths.
- The public **`README.md` is a judged deliverable** (it must cover NVIDIA model use, Nebius use and setup). Write it in the Oct 28 slot. Don't put internal notes in it.
