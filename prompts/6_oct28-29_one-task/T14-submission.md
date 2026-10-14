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
- `SPEC.md` §1, §3 and **§15 (the product as built)**
- `docs/PIVOT-PLAN.html` (the story)
- `docs/FEEDBACK.md`
- `docs/DEPLOY.md`
- `bench/results/` (summaries only)

**`README.md`:** judge-facing. Replace the stub with:
- a hook line, plus a GIF or screenshot
- **"For judges: try it in 60 seconds"** near the top: the live URL; pick the coffee-roaster example (REPLAY, free); click any grid cell to replay it; add your own plan row; press "Check live news" (a real Tavily call); or type your own business for a LIVE analysis. The form has no testing field, so this is where testing instructions go.
- the problem (a small business hit by news has no analyst to test its options), and what the project does
- a **Mermaid architecture diagram** showing:
  - profile text → Super → engine calibration
  - Tavily → Super news parser → shock cases
  - the Ultra analyst loop (strict-JSON actions → planner → results) and the Lightning shopper groups
  - the memo
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
- a "why you can trust the numbers" section: LLMs choose, the engine computes; common random numbers; paired comparison against "Do nothing"; the 1-in-20 bad case; 10,000 runs per cell on Nebius
- how to run it locally, and how to deploy
- limitations
- license

**`docs/VIDEO_SCRIPT.md`:** a 2:45 script with timestamps and on-screen actions, in five acts:

| Time | Act |
|---|---|
| 0:00–0:20 | Problem: a coffee roaster in Ho Chi Minh City reads that robusta jumped 31%. What should she do? |
| 0:20–0:45 | She types her business; Nemotron Super fills the fields; Tavily finds the news and its cost to her |
| 0:45–1:45 | The Nemotron Ultra analyst tests plans, the shoppers react, the grid fills in; "Best today" and "Safest" appear |
| 1:45–2:15 | Replay the winning plan in the pixel arena; the rival sells out in week 7; the memo |
| 2:15–2:45 | How it works: Token Factory tiers and measured savings, Serverless Job "verified", Tavily quotes |

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
- [ ] REPLAY works for all 3 example businesses
- [ ] one LIVE analysis of a typed-in business completes
- [ ] adding your own plan works in REPLAY
- [ ] "Verify with 10,000 runs" completes on Nebius
- [ ] the mobile layout works
- [ ] LICENSE is visible at the repo root
- [ ] no secrets in git history: `git log -p | grep -iE "api_key|sk-|tvly-"` is clean
- [ ] the video is on YouTube or Vimeo, **public or unlisted**, with no password, and everything important happens before 3:00
- [ ] "Check live news" makes a real Tavily call from a logged-out browser in REPLAY mode
- [ ] every required (*) field in SUBMISSION.md has an answer
- [ ] the repo is public

Commit as `T14: submission docs`.
