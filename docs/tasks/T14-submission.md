# T14: README, video script, Devpost text, final QA

| | |
|---|---|
| Model | **Sonnet 5.5**, effort high, **plus you** |
| Time | ~3 h |
| When | Oct 28–29. Submit by **Fri Oct 30, 12:00 GMT+7**. |

---
You are preparing the hackathon submission for the Market Digital Twin.

**Read only these:**
- `SPEC.md` §1, §2, §3
- `docs/FEEDBACK.md`
- `docs/DEPLOY.md`
- `bench/results/` (summaries only)

**`README.md`:** judge-facing. Replace the stub with:
- a hook line, plus a GIF or screenshot
- the problem, and what the project does
- a **Mermaid architecture diagram** showing:
  - Tavily → Super shock parser → engine
  - the Ultra CEOs and the Lightning crowd
  - Token Factory
  - the Serverless Endpoint and Serverless Job
- a model routing table with the measured numbers
- **how NVIDIA Nemotron and Nebius are used:** Token Factory runtime calls, the Serverless Endpoint, the Serverless Job
- how Tavily is used
- an econometric validity section: common random numbers, paired t-test, effect size
- how to run it locally, and how to deploy
- limitations
- license

**`docs/VIDEO_SCRIPT.md`:** a 2:45 script with timestamps and on-screen actions, in four acts:

| Time | Act |
|---|---|
| 0:00–0:25 | Problem |
| 0:25–1:30 | Live Tavily shock and agents reasoning |
| 1:30–2:15 | Econometric proof (AI alpha, Nash, bullwhip) |
| 2:15–2:45 | Nebius/NVIDIA architecture and telemetry |

**`docs/DEVPOST.md`:** every Devpost text field:
- tagline
- inspiration
- what it does
- how we built it
- challenges
- accomplishments
- what we learned
- what's next
- built with
- testing instructions for judges (REPLAY is the default; how to try LIVE)
- feedback (a summary of FEEDBACK.md)

**QA checklist** (`docs/QA.md`). Run it in a logged-out browser and tick each item:
- [ ] the live URL loads
- [ ] REPLAY works for all 3 scenarios
- [ ] one LIVE run completes
- [ ] the mobile layout works
- [ ] LICENSE is visible at the repo root
- [ ] no secrets in git history: `git log -p | grep -iE "api_key|sk-|tvly-"` is clean
- [ ] the YouTube video is **public** and under 3:00
- [ ] the repo is public

Commit as `T14: submission docs`.
