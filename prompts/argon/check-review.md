# Check an Argon review (Claude prompt)

| | |
|---|---|
| Builder | **Claude Code**: Sonnet 5.5, effort medium. Use **Opus 5.5** for A3 (the whole-repo review). |
| Start | New session in this folder, then type: `Check the Argon review in dist/argon/A1/ using prompts/argon/check-review.md` (use the right review ID) |

---
The newest `dist/argon/<ID>/ANSWER-*.md` holds review findings from Gemini 4 Argon. The review's prompt is in `prompts/argon/reviews/<ID>-*.md`. Argon sometimes makes things up and couldn't run the code.

1. **Verify every finding** against the actual files. Mark each one confirmed, rejected (with a one-line reason), or unsure.
2. **Fix the confirmed ones,** smallest change first, and commit them as `Argon <ID> fixes: <summary>`. Only `git add` the files you changed.
   - Don't change the shared contracts (`backend/engine/types.py`, `docs/EVENTS.md`, `backend/config.py`, SPEC §4.7) without asking me. List those as proposals instead.
   - If a fix belongs to a task another session is working on right now, list it for me instead of editing.
3. **Log platform findings.** If a finding is about Nemotron, Token Factory, Nebius or Tavily, add a row to `docs/FEEDBACK_LOG.md`.
4. **Reply with a table:** finding → verdict → what you did.
