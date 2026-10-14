# A8: video critique

| | |
|---|---|
| When | Oct 28 · **must-do** (Claude can't watch video) |
| Upload | **you upload** the draft demo video file |
| Pack | `uv run scripts/argon.py pack A8` |
| After | `uv run scripts/argon.py import A8`, then you read it and fix the video; no Claude check needed |

Steps: `prompts/argon/HOW-TO.md` → "Run a review". The prompt below is copied into `dist/argon/A8/PROMPT.txt` for you.

```text
Attached: a draft hackathon demo video. Only the first 3:00 is reviewed. Judges: engineers from NVIDIA and Nebius plus Tavily staff. Criteria (equal weight): Technological Implementation, Design, Potential Impact, Quality of Idea. Stage 1 is pass/fail on meaningful use of NVIDIA Nemotron models, Nebius (Token Factory / Serverless) and the track fit (Best Apps and Agents).
Give: a score out of 10 per criterion with one-line reasons; the exact timestamp where each of these is first shown or said — Nemotron, Token Factory, Nebius Serverless, Tavily, the AI-vs-baseline result — and flag any that are missing or come too late; every moment that is confusing, too fast, silent or has unreadable text (timestamp + fix); and a tighter running order if one would help. Be blunt.
```
