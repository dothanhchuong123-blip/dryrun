# How to use Gemini 4 Argon on this project

**Gemini 4 Argon** is your Gemini Pro plan's model (pick **Argon High** next to the input box). It's strong at coding, long files (1M tokens) and watching video, and using it costs **no Claude quota**. It does make things up sometimes, so a short Claude session checks everything it produces before it's committed.

## Do I give Gemini access to this folder?

**No.** Even if Gemini offers folder or Drive access, don't use it here, for two reasons:
- This folder holds your API keys (`.env`).
- Claude sessions are editing the same files at the same time.

Instead, a script copies exactly the files Gemini needs into **one file, `UPLOAD_ME.md`**. That file never contains keys. You upload it with the **+** button.

**Chat or Task mode?** Either works.
- **Chat:** the safe default. You get the answer as text and copy it back with one click.
- **Task:** worth trying for the frontend (T10–T12), since it may be able to run and preview the UI. If Task mode gives you a download (.zip), import that instead of copying.

## Who does what (3 Pro accounts)

| Account | Oct 15 (wave 1) | Oct 16–17 (wave 2) | Reviews |
|---|---|---|---|
| **#1** | T01 market engine | T03 stats + Monte Carlo (after T01 and T02 are committed) | A1 spec math (Oct 15) |
| **#2** | T02 inventory + game theory | T12 arena (after T10 is committed) | A3 repo review (Oct 18, Oct 26) |
| **#3** | T10 frontend shell | T11 charts + news cards (after T10 is committed) | A8 video (Oct 28) · A9 judge simulation (Oct 29) |

Claude builds everything else: T04–T09, T13 and T14. Those tasks need your API keys, live Nemotron or Tavily calls, the Nebius console, or the whole repo at once.

## Build a task (T01, T02, T03, T10, T11, T12)

Example: **T01** on account #1.

1. **Pack it.** In a terminal in the project folder (`/Users/dochuong/Nebia x Nvidia`), run:
   ```bash
   uv run scripts/argon.py pack T01
   ```
   Finder opens `dist/argon/T01/`, which holds `UPLOAD_ME.md` and `PROMPT.txt`.
2. **Send it.** In Gemini (account #1):
   1. Start a **new chat** and pick **Argon High**.
   2. Click **+** and upload `UPLOAD_ME.md`.
   3. Open `PROMPT.txt`, select all, copy, and paste it into the message box.
   4. Send.
3. **Wait.** Builds take a while. If the answer stops part-way, the import step tells you; reply `continue` in Gemini and repeat step 4 for each part.
4. **Bring it back.** Click the **copy icon** under Gemini's answer, then run:
   ```bash
   uv run scripts/argon.py import T01
   ```
   This saves the answer to `dist/argon/T01/ANSWER-1.md` and writes **only T01's own files** into the repo. It refuses anything else, including the shared contracts.
   - If Task mode gave you a .zip instead, run: `uv run scripts/argon.py import T01 ~/Downloads/<name>.zip`
5. **Have Claude check it.** Open a new Claude Code session (**Sonnet 5.5, effort medium**) and type:
   `Check the Argon build of T01 using prompts/argon/check-build.md`

   Claude runs the tests, fixes small problems, and commits as `T01: … (built by Gemini 4 Argon, checked by Claude)`.

The other builds work the same way: just swap `T01` for the task ID.

## Run a review (A1–A9)

| ID | When | Prompt file | Must-do? |
|---|---|---|---|
| A1 | **Oct 15** | `prompts/argon/reviews/A1-spec-math.md` | ✅ |
| A2 | Oct 17 | `prompts/argon/reviews/A2-prompt-redteam.md` | |
| A3 | **Oct 18 and Oct 26** | `prompts/argon/reviews/A3-repo-review.md` | ✅ |
| A4 | Oct 17 and Oct 25 | `prompts/argon/reviews/A4-calibration.md` | |
| A5 | Oct 23–24 | `prompts/argon/reviews/A5-ui-critique.md` | |
| A6 | Oct 26 | `prompts/argon/reviews/A6-charts-vs-claims.md` | |
| A7 | Oct 25 | `prompts/argon/reviews/A7-nemotron-vs-argon.md` | |
| A8 | **Oct 28** | `prompts/argon/reviews/A8-video-critique.md` | ✅ |
| A9 | **Oct 29** | `prompts/argon/reviews/A9-judge-sim.md` | ✅ |

Example: **A1**.
1. **Pack it:**
   ```bash
   uv run scripts/argon.py pack A1
   ```
   Finder opens `dist/argon/A1/`.
2. **Send it.** In Gemini, start a new chat with **Argon High**. Upload everything in that folder **except** `PROMPT.txt`, then paste `PROMPT.txt` as your message. For A5 and A8, upload your own screenshots or video instead.
3. **Bring it back.** Copy the answer, then run:
   ```bash
   uv run scripts/argon.py import A1
   ```
   The answer is saved to `dist/argon/A1/ANSWER-1.md`.
4. **Check it.** Open a new Claude Code session (Sonnet 5.5, effort medium; use **Opus** for A3) and type:
   `Check the Argon review in dist/argon/A1/ using prompts/argon/check-review.md`

   For A5, A7 and A8, the review file says what to do instead (you read it and decide).

## Rules
- Never paste keys or `.env` into Gemini. The packs are already safe; don't add files to them by hand.
- Nothing Argon writes counts as done until its Claude check has committed it.
- Wave 2 builds need wave 1's code **committed first**, because the pack copies the current files. Example: pack T03 only after T01 and T02 are checked and committed.
