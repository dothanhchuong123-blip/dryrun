# A5: ui critique

| | |
|---|---|
| When | Oct 23–24 · optional |
| Upload | **you upload** 4–6 screenshots and a 30–60 s screen recording of the app |
| Pack | `uv run scripts/argon.py pack A5` |
| After | `uv run scripts/argon.py import A5`, then you read it and pick fixes; paste the ones you want into a Claude session |

Steps: `prompts/argon/HOW-TO.md` → "Run a review". The prompt below is copied into `dist/argon/A5/PROMPT.txt` for you.

```text
Attached: screenshots and a short screen recording of a hackathon demo app (a market simulator: left = news cards and agent reasoning, middle = animated consumer arena, right = charts and stats). Judges are engineers from NVIDIA, Nebius and Tavily who will spend about 2 minutes on it. "Design" is 25% of the score.
Tell me: what a first-time viewer understands in the first 10 seconds and what they miss; the 5 most valuable changes (layout, hierarchy, labels, colour, motion), each doable in under an hour; any text too small to read at 1080p; and anything that looks broken or janky in the recording, with timestamps.
```
