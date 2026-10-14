# T13: Benchmark suite and the feedback report

| | |
|---|---|
| Builder | **Claude Code**: **Sonnet 5.5**, effort medium. Haiku is fine for the write-up. |
| Start | New Claude Code session in this folder → pick that model → type: `Do the task in prompts/5_oct25-26_one-task/T13-benchmark-feedback.md` |
| Parallel with | nothing |
| Time | ~3 h |
| When | Oct 25–26 |

---
You are producing the data-driven Nebius and NVIDIA feedback report. It's a required submission field and our entry for the Most Valuable Feedback prize.

**Read only these:**
- `SPEC.md` §7.1, §8, §13
- `scripts/day1_check.py`
- the public APIs of `backend/services/router.py`, `backend/services/telemetry.py` and `backend/agents/prompts.py`
- `bench/results/*`
- `docs/FEEDBACK_LOG.md` (problems logged during the build)
- `docs/SUBMISSION.md` §III (the Devpost feedback questions, Q9–Q17)

**`bench/run_bench.py`:**
- Use the real task prompts with a realistic state.
- **Models:** Ultra (thinking on and off), Super, Lightning, Nano.
- **Plus one non-NVIDIA reference model** from Token Factory's `GET /v1/models`, close to Super in size. Run it on the **CEO prompt only**, n=5, at concurrency 1. Devpost Q12 asks how Nemotron compares with other models.
- **Concurrency:** 1, 4, 16.
- **Sample size:** n per cell defaults to 10; Ultra with thinking on uses n=5.
- **Record:**
  - TTFT p50/p95
  - total latency
  - tok/s
  - reasoning tokens
  - schema-valid rate
  - 429s
  - cost
- **Hard cap:** abort once the estimated spend passes $2. Ask me before raising it.
- **Output:** CSV plus PNG charts in `bench/results/`. Add matplotlib as a dev dependency.

**`docs/FEEDBACK.md`:**
- Quote exact numbers from the benchmark results only.
- **What worked:**
  - OpenAI compatibility
  - strict json_schema working with thinking on
  - `reasoning_content` arriving separately
  - per-model rate-limit headers
- **Friction:**
  - `reasoning_budget` and `reasoning_effort` are ignored on Ultra
  - model ID casing is inconsistent
  - Nano's TTFT vs Lightning's
  - the JSON docs page's code example is missing commas
  - the two base URLs list 25 vs 18 models
  - Serverless presets and cold starts, from `bench/results/serverless.json`
- Pull every friction item from `docs/FEEDBACK_LOG.md`. Each one needs evidence: a number, a request, or a docs link.
- **Concrete recommendations.**
- Include the tables and charts.
- **End with "Devpost answers":** one ready-to-paste paragraph for each of Q9, Q11, Q12, Q13, Q16 and Q17 (`docs/SUBMISSION.md`).
  - For the 1–10 ratings (Q10, Q14, Q15), list the evidence only. The user picks the numbers.
  - Claim nothing we didn't measure. Label the Gemini 4 Argon comparison as qualitative.

Commit as `T13: benchmark suite + FEEDBACK.md`.
