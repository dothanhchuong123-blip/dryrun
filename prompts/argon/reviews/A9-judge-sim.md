# A9: judge sim

| | |
|---|---|
| When | Oct 29 · **must-do** |
| Upload | `README.md`, `docs/DEVPOST.md`, `docs/FEEDBACK.md`, `docs/SUBMISSION.md` + gallery PNGs (packed for you) |
| Pack | `uv run scripts/argon.py pack A9` |
| After | `uv run scripts/argon.py import A9`, then Claude check for text fixes; you decide on bigger changes |

Steps: `prompts/argon/HOW-TO.md` → "Run a review". The prompt below is copied into `dist/argon/A9/PROMPT.txt` for you.

```text
You are a judge for the Nebius x NVIDIA Global AI Hackathon, Best Apps and Agents track. Attached: the project README, Devpost text, feedback report and submission checklist (UPLOAD_ME.md), plus the gallery images.
Stage 1 (pass/fail): is the use of NVIDIA Nemotron and Nebius meaningful rather than a thin wrapper? Is the track fit genuine? Answer with reasons.
Stage 2: score 1–10 each for Technological Implementation, Design, Potential Impact and Quality of Idea, with reasons.
Then: the 5 changes that would raise the score most and can be made in one day; any claim that sounds unsupported or exaggerated; and anything a judge would look for and not find (setup steps, license, how to try it, model choices explained).
```
