# Check an Argon build (Claude prompt)

| | |
|---|---|
| Builder | **Claude Code**: Sonnet 5.5, effort medium |
| Start | New session in this folder, then type: `Check the Argon build of T01 using prompts/argon/check-build.md` (use the right task ID) |

---
Gemini 4 Argon wrote the code for one task, and `scripts/argon.py import` has already written it into the working tree, uncommitted. Argon had no repo and couldn't run our tests, so expect small integration bugs.

1. **Read the task.** Read the task file `prompts/*/<ID>-*.md`. Read the "## Notes" section at the end of the newest `dist/argon/<ID>/ANSWER-*.md`, if there is one.
2. **Check the scope.** Run `git status --short`. Only that task's files may have changed, apart from other sessions' work in progress. If a file outside the task changed, stop and tell me.
3. **Run the checks.**
   - Python tasks: `uv run pytest -q <the task's test file>` and `uv run ruff check backend tests`.
   - Frontend tasks: `cd frontend && npm install && npm run build`, then run the dev server with the mock stream and take a screenshot.
4. **Fix failures** with the smallest change. Never edit the shared contracts (`backend/engine/types.py`, `docs/EVENTS.md`, `backend/config.py`, SPEC §4.7). If one of them needs a change, ask me.
5. **Check the code against the task, not just the tests:**
   - Every listed file and function exists, with the right signature.
   - Every listed test exists and really tests its claim (no trivial asserts).
   - Performance targets are actually measured.
   - The engine does no I/O.

   Fill any gaps.
6. **Run the whole suite:** `uv run pytest -q`. Other sessions may have work in progress; only failures in this task's files block you.
7. **Commit only this task's files:** `git add <files>`, then commit as `<ID>: <summary> (built by Gemini 4 Argon, checked by Claude)`. If git says `index.lock` exists, wait a few seconds and retry.
8. **Reply in ≤ 6 lines:** what you fixed, and what Argon got wrong. I use this for the Devpost learning answers.
