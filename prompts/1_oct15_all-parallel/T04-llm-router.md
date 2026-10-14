# T04: LLM router, rate limiter, telemetry, spend guard

| | |
|---|---|
| Builder | **Claude Code**: **Sonnet 5.5**, effort medium |
| Start | New Claude Code session in this folder → pick that model → type: `Do the task in prompts/1_oct15_all-parallel/T04-llm-router.md` |
| Parallel with | T05 (Claude) · T01, T02, T10 (Argon) |
| Time | ~3 h |
| Depends on | nothing |

---
You are implementing the Nebius Token Factory client layer for the Market Digital Twin.

**Read only these:**
- `SPEC.md` §3.2, §3.3, §5, §7.1, §8
- `backend/config.py`. Read keys and IDs only through `get_settings()`, and never log keys.
- `scripts/day1_check.py`. It already has working streaming, `reasoning_content`, rate-limit headers and strict-schema code; reuse those patterns.
- the `telemetry` event in `docs/EVENTS.md`

**`backend/services/router.py`:**
- `to_strict_schema(model: type[BaseModel]) -> dict`: sets `additionalProperties: false`, makes all properties required, and inlines `$defs`.
- `class NemotronRouter`, built on `openai.AsyncOpenAI(base_url, api_key, max_retries=0)`.
- `async call(tier: Literal["ultra", "super", "fast"], messages, schema, *, thinking: bool, max_tokens: int, timeout: float | None = None, on_reasoning=None, role: str = "") -> CallResult(parsed, raw_text, reasoning_text, record, fallback_needed)`. It must:
  - Send `response_format` as a strict json_schema and pass `extra_body={"chat_template_kwargs": {"enable_thinking": thinking}}`.
  - Stream with `include_usage`, and pass `delta.reasoning_content` (falling back to `delta.reasoning`) to `on_reasoning`.
  - Validate with Pydantic. On failure, retry **once** with the validation error appended. If that fails too, set `fallback_needed=True`.
  - For the fast tier, retry once on `model_fast_fallback` (Nano) if there's an error or timeout.
  - Default timeouts: ultra 30 s, super 10 s, fast 5 s. Default max_tokens: ultra 3000, super 600, fast 800.

**`backend/services/limiter.py`:**
- One async token bucket per model, for both RPM and TPM.
- Start values: Ultra/Super 300 RPM / 200k TPM, Lightning 600 / 400k, Nano 100 / 800k.
- Update the buckets from the `x-ratelimit-limit-*` and `x-ratelimit-remaining-*` headers. On a 429, honour `Retry-After`.
- Priority: when a bucket drops below 20%, reject fast-tier calls immediately; the caller then uses its fallback.

**`backend/services/telemetry.py`:**
- `CallRecord` with the fields listed in SPEC §8. Compute the cost from `config.PRICES_PER_M`.
- `TelemetryStore`: appends to `telemetry/calls-YYYYMMDD.jsonl`. `snapshot()` returns the `telemetry` event payload from EVENTS.md. `cost_all_ultra_usd` prices the same tokens at Ultra rates.
- `SpendGuard(cap)`: computes today's spend from the jsonl. `allow()` returns False once the cap is reached.

**Tests in `tests/test_router.py`** (no network; mock the stream with fake chunks):
- A stream of reasoning + content + usage produces the parsed model, a correct record, and the reasoning callbacks in order.
- Invalid then valid output → exactly 1 retry.
- Invalid twice → `fallback_needed`.
- The limiter waits on an exhausted bucket (fake clock).
- Telemetry shares and savings maths.
- The spend guard trips at the cap.

**Optional live smoke test** (costs under $0.01): `uv run python -m backend.services.router --smoke` calls Super and the fast tier once each, with thinking off.

**Done when** pytest and ruff pass. Commit as `T04: Nemotron router, limiter, telemetry`.
