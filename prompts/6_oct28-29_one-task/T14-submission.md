# T14: README, video script, Devpost text, final QA

| | |
|---|---|
| Builder | **Claude Code**: **Sonnet 5.5**, effort high, **plus you** |
| Start | New Claude Code session in this folder → pick that model → type: `Do the task in prompts/6_oct28-29_one-task/T14-submission.md` |
| Parallel with | nothing |
| Time | ~3 h |
| When | Oct 28–29. Submit by **Fri Oct 30, 12:00 GMT+7**. |

---
You are preparing the hackathon submission for the Market Digital Twin.

**Read only these:**
- `docs/SUBMISSION.md`: **the real Devpost form, field by field. Follow it exactly.**
- `SPEC.md` §1, §2, §3
- `docs/FEEDBACK.md`
- `docs/DEPLOY.md`
- `bench/results/` (summaries only)

**`README.md`:** judge-facing. Replace the stub with:
- a hook line, plus a GIF or screenshot
- **"For judges: try it in 60 seconds"** near the top: the live URL, REPLAY by default, how to start LIVE, and the "Check live news" button. The form has no testing field, so this is where testing instructions go.
- the problem, and what the project does
- a **Mermaid architecture diagram** showing:
  - Tavily → Super shock parser → engine
  - the Ultra CEOs and the Lightning crowd
  - Token Factory
  - the Serverless Endpoint and Serverless Job
- a model routing table with the measured numbers
- **how NVIDIA Nemotron and Nebius are used:** Token Factory runtime calls, the Serverless Endpoint, the Serverless Job
- **where Token Factory sped up our workflow** (the form asks for this explicitly):
  - one key and an OpenAI-compatible client for four Nemotron tiers;
  - model swaps as env vars made the tier benchmark cheap;
  - no GPUs to provision;
  - rate-limit headers drove our limiter.
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

**`docs/DEVPOST.md`:** fill in every field from `docs/SUBMISSION.md`, in the same order, ready to paste:
- **Name and elevator pitch** (≤ 200 characters).
- **"About the project":** one Markdown story with these headings:
  - Inspiration
  - What it does
  - How we built it (include one `$$…$$` LaTeX equation, the MNL formula from SPEC §4.1)
  - Challenges
  - What we learned
  - What's next
  - How to try it
- **Built-with tags.**
- **Q9–Q17:** take them from FEEDBACK.md's "Devpost answers".
- **👤 fields** (ratings, learning, career value): leave them for the user, with the evidence next to each.

**Gallery:** save 6 PNGs at 1800×1200 (3:2), each < 5 MB, in `docs/media/`. Use the shot list in SUBMISSION.md and capture them with the browser at that viewport.

**QA checklist** (`docs/QA.md`). Run it in a logged-out browser and tick each item:
- [ ] the live URL loads
- [ ] REPLAY works for all 3 scenarios
- [ ] one LIVE run completes
- [ ] the mobile layout works
- [ ] LICENSE is visible at the repo root
- [ ] no secrets in git history: `git log -p | grep -iE "api_key|sk-|tvly-"` is clean
- [ ] the video is on YouTube or Vimeo, **public or unlisted**, with no password, and everything important happens before 3:00
- [ ] "Check live news" makes a real Tavily call from a logged-out browser in REPLAY mode
- [ ] every required (*) field in SUBMISSION.md has an answer
- [ ] the repo is public

Commit as `T14: submission docs`.
