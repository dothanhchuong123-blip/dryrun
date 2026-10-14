# Task prompts: run each one in a fresh session

Each `Txx-*.md` file below contains a self-contained prompt.

**How to run a task:**
1. Open a **new** Claude Code session in this folder (`/Users/dochuong/Nebia x Nvidia`).
2. Pick the model and effort listed for the task.
3. Paste everything under the `---` line.
4. When it's done, review `git diff`, run `uv run pytest`, and commit.

`CLAUDE.md` loads automatically, so the prompts point to sections of `SPEC.md` rather than pasting it in.

## Which model?

| Model | Use for | Tasks |
|---|---|---|
| **Sonnet 5.5** (default) | Well-specified coding | T01–T06, T08–T13 |
| **Haiku 5.5** | Mechanical work: docs, fixtures, simple edits | parts of T13–T14, small fixes |
| **Opus 5.5** | Tricky integration and design, final review | T07 (orchestrator), merge reviews |
| **Antigravity / Gemini** (`agy`) | Research, second-opinion reviews | Anything that only needs to read |

## Order and dependencies (dates GMT+7)

```
Oct 15–16  T01 engine-market ─┬─ T03 stats+MC ─┐
           T02 inventory+game ┘                │
           T04 llm-router ──┬─ T06 tavily ─────┼─ T07 orchestrator (Milestone A, Oct 18)
           T05 schemas+prompts ┘               │        │
Oct 19–20                                      └─ T08 API/SSE/replay ─ T09 Nebius deploy (Milestone B, Oct 20)
Oct 21–24  T10 frontend shell (start any time, uses mock SSE) → T11 terminal+charts → T12 arena
Oct 25–26  T13 benchmark + FEEDBACK.md
Oct 27     feature freeze · record replays
Oct 28–29  T14 README + video script + Devpost + QA
```

You can run these **in parallel**, since they touch different files: T01 + T02 + T04 + T05 + T10.

## Rules for every session (these keep the quota down)

- **One task per session.** Start a fresh session for each task rather than continuing a long chat; use `/clear` between tasks.
- **Read only what the prompt names.** Don't "explore the repo".
- **Stay inside the task's file list.** If `backend/engine/types.py` or `docs/EVENTS.md` needs to change, stop and ask. Those are shared contracts.
- **No live LLM or Tavily calls in tests.** Mock them. Live calls only happen when the prompt says so, and they count against the $25 budget.
- **Commit format:** `Txx: <summary>`.
- **Ask the user** before any action estimated at more than $1.
