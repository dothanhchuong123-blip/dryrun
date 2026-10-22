# F6: Tell the user when Token Factory is down or slow ("model-trouble notice")

Read `CLAUDE.md` and `SPEC.md` §15 first, and follow the guardrails in CLAUDE.md. Pay special attention to the rules on keys and `.env`, the $1 ask rule and the freeze rule.

**Model:** Claude Sonnet 5.5 (effort high). **Needs:** commits bd8e6f5 and ebad7eb on `ui/guided-flow`. **Contract change:** none planned. The `error` event keeps `{message, recoverable}`. If you find you need a new field, stop and ask the user before you edit `docs/EVENTS.md`. **Token Factory spend:** $0. Use fakes in tests, and test the live path with a bad key, which is free. Ask before spending anything.

## Why
On 2026-10-22 the account ran out of credit (HTTP 402). On the same day Lightning answered only 18% of calls on the first try, and Ultra/Super timed out on 4 of 52 calls. In both cases a LIVE run still "finished":
- every failed call fell back to the engine's fixed plans, neutral shoppers and a template memo;
- the only sign was a small line: "Some steps used a plain fallback." (`StageAnswer.tsx:310`, `MemoScreen.tsx:260`).

So the owner gets an answer that looks like Nemotron's and isn't. A judge using the live demo between Oct 30 and Dec 15 could see the same thing.

Build three things:
- **A.** Stop a LIVE run early, with a clear message, when the models can't be reached at all.
- **B.** When the run finishes but some calls fell back, say how much fell back on the Answer step.
- **C.** Stop `--record` from saving a run where Ultra or Super fell back.

## What already exists (don't rebuild it)
- **`backend/services/router.py`, `NemotronRouter.call()`:**
  - Every failure ends in `finish(True)`: a `CallRecord` with `status`, `fallback_used` and `json_valid`, saved to `telemetry/calls-YYYYMMDD.jsonl`.
  - `_stream_once` turns every non-429, non-timeout exception into `_CallError("error")`, so a 402, a 401 and a 503 all look the same.
  - The fast tier retries on `fast_fallback` (Nano).
  - When the spend guard trips, `rec.status = "capped"`.
- **`backend/agents/analyst.py`:**
  - `_fallback()` emits `agent_step` with `kind: "fallback"` and sets `self.fallback_used`.
  - Crowd halves that fail come back as neutral rows: `mu [0, 0]`, `sigma [0.1, 0.1]`, `bubble ""` (`_crowd_rows`).
  - `scenarios.fallback_used` and `memo.fallback_used` are already sent.
- **`backend/sim/analysis.py`, `Analysis.run()`:** catches any exception, then sends `error {message, recoverable: false}` followed by `done`.
- **`telemetry` event:** carries `tiers.{ultra,super,fast}.errors`.
- **Frontend:**
  - `store.ts:288` sets `analysis.status = "error"` with a `note`.
  - `AgentStepKind` already includes `"fallback"`.
  - `StageTest.tsx` and `AnalystLog.tsx` already tag fallback rows.
- **`backend/sim/cli.py`:** `record_files()` writes the recordings after a `--record` run.

## A. Stop early when the models are unreachable (backend + frontend)

1. **Router: classify the failure.**
   - In `_stream_once`, catch `openai.APIStatusError` before the generic `Exception`, and map it by `status_code`:
     - 402 → `"no_credit"`
     - 401 and 403 → `"auth"`
     - 5xx → `"server_error"`
     - anything else → `"error"`
   - Add `error: str` to `CallRecord`: at most 120 characters, made of the status code and the API's error `code` or `type` (e.g. `402 credit_balance_exhausted`). Never include headers, the request, the key or the prompt.
   - Check the telemetry readers and `/api/telemetry` still work with the new field and the new status values.
2. **Router: a run-level "hard failure" flag.**
   - Expose `router.hard_failure: str | None`, set by the first call of any tier that ends with:
     - `no_credit`, `auth` or `capped`; or
     - two Ultra/Super calls **in a row** ending in `server_error`. One 5xx can be a blip.
   - Timeouts, 429s and invalid JSON never set it. Those are "slow", not "down", and are handled in B.
   - Check how `Analysis` gets its router (one per run, or shared). The flag must be per run, so a dead call in one visitor's run can't stop another visitor's.
3. **Analyst: stop.**
   - Check `router.hard_failure` at these points:
     - after the news/futures step;
     - after each Ultra round;
     - before the memo.
   - If it is set, raise a new `ModelsUnavailable(reason)`. Don't spend more calls once the account is known to be dead: on a 402, today's code makes every remaining call and then writes a template memo.
   - In `Analysis.run()`, catch it before the generic handler. Send `error` with `recoverable: true` and a plain message, then `done`:
     - `no_credit`, `auth` → "The AI models aren't available right now, so this live run stopped. You can watch a recorded run instead."
     - `capped` → "Today's live budget is used up, so this live run stopped. You can watch a recorded run, or try live again tomorrow."
     - `server_error` → "Token Factory isn't answering right now, so this live run stopped. Try again in a few minutes, or watch a recorded run."
   - Don't name Nebius error codes or show stack traces to the user; log them.
4. **Frontend.**
   - Where the analysis `error` is shown, a `recoverable: true` error gets:
     - the message;
     - a primary button, **Watch a recorded run**. It plays the closest example's recording; if the run had no example, it plays the default coffee example. Use the existing replay or example path. No new endpoint.
     - a secondary button, **Try again**.
   - Keep the old look for `recoverable: false`.
   - Read `docs/DESIGN.md` §12 for tone and styling.
   - Nothing here runs in REPLAY. A recording never sends this error.

## B. "How much of this is Nemotron" notice on the Answer step (frontend only)

Count what the run already sent. There are no new events.
- **Shoppers:** across all `crowd` events, count rows that are the neutral fallback (`bubble === ""` and `mu` = `[0, 0]`) against all rows.
  - Check in `backend/agents/schemas.py` that a real answer can't have an empty bubble. If it can, tell the user and pick a safer test.
- **Analyst:** count the `agent_step` events with `kind === "fallback"`, plus `scenarios.fallback_used`.
- **Memo:** `memo.fallback_used`.

Replace the one-line "Some steps used a plain fallback." in `StageAnswer.tsx` and the `mm-fallback` line in `MemoScreen.tsx` with one small notice. Show it only when something fell back. Write it in plain words, e.g.:
- "Nemotron was slow on this run: 9 of 96 shopper answers were missing and counted as neutral."
- "The analyst's step 2 used the built-in plans."
- "This memo was written from a template, not by Nemotron Ultra."

Order the lines most serious first: memo, then analyst, then shoppers. Hide the shopper line under 5% missing; old recordings have a few dropouts and that's normal. Put the counting in a small pure function in `frontend/lib/`, with a unit test if the frontend has a test runner. If it doesn't, keep the function trivially checkable.

Recordings replay through the same events, so old recordings with dropouts will show the notice. That's correct; don't hide it in REPLAY.

## C. `--record` refuses a run with Ultra/Super fallback (backend)
- In `backend/sim/cli.py`, before `record_files()` writes anything, check this run's call records. Abort if any Ultra or Super call ended with `fallback_used`.
  - Print each failed call's role, tier, status and the new `error`. Exit non-zero.
  - Shopper (fast-tier) fallbacks are allowed, as in the 2026-10-22 re-records.
  - Add `--allow-fallback` to override.
- Read only this run's records, not the whole day's file.
- Don't touch any file in `fixtures/replays/` (B1 freeze rule).

## Tests (all offline, $0)
- **Router:** a fake client raising `APIStatusError` with 402, 401 and 503.
  - Check `status` and `error` on the record.
  - Check `hard_failure` is set on 402 and 401, but not on a single 503.
  - Check two 503s in a row on Ultra/Super set it.
  - Check a timeout never sets it.
- **Analysis:** a fake router that returns 402 on every call. The stream must:
  - end with `error {recoverable: true}` and then `done`;
  - have no `memo` event;
  - make fewer calls than a full run (assert a small number).
- **CLI:** `--record` with a fake Super fallback aborts and writes nothing. `--allow-fallback` writes.
- **Gates:** `uv run pytest -q` and `uv run ruff check backend tests` pass, plus the frontend's lint and type check.

## Check it in the app (free)
- **Notice (B):** run `./dev.sh` (offline replay). The coffee recording should show the notice if it has dropouts; check the wording.
- **Stop path (A):** run the live stack with an invalid key from the environment, e.g. `NEBIUS_API_KEY=invalid ./dev.sh --live`. Check that environment variables override `.env` in `get_settings()` before relying on this. Then start a custom-profile run.
  - It should stop within one call with the auth message and the two buttons.
  - **Watch a recorded run** should play.
- Take a screenshot of each.
- Never print `.env` or the real key.

## Done when
- A, B and C work, and the tests above pass.
- Add one row to `docs/FEEDBACK_LOG.md`: Token Factory's 402 body (`credit_balance_exhausted`) is a clear, machine-readable signal, and the app now uses it.
- Tick F6 on `prompts/README.md`.
- Don't commit or push unless the user asks. Pushing `ui/guided-flow` deploys to Render.

## Out of scope
- A lifetime spend cap.
- Moving the spend-guard file off Render's ephemeral disk.
- Retrying failed calls differently.
- Re-recording anything.
- Changing any prompt, seed or case text.
