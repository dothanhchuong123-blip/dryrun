"""T04 tests: no network. The transport (`_open`) is replaced with fake chunk streams."""
from contextlib import asynccontextmanager
from types import SimpleNamespace as NS

import pytest
from pydantic import BaseModel, Field

from backend.config import PRICES_PER_M
from backend.services import limiter as lim
from backend.services.router import NemotronRouter, to_strict_schema
from backend.services.telemetry import CallRecord, SpendGuard, TelemetryStore, cost_usd


class Inner(BaseModel):
    x: float = Field(ge=0, le=1)


class Out(BaseModel):
    a: int
    inner: Inner
    items: list[Inner] = []
    note: str = "n"


def chunk(content=None, reasoning=None, usage=None, choices=True):
    delta = NS(content=content, model_extra={"reasoning_content": reasoning} if reasoning else {})
    return NS(choices=[NS(delta=delta)] if choices else [], usage=usage)


def usage(p, c, r=0):
    return NS(prompt_tokens=p, completion_tokens=c, completion_tokens_details=NS(reasoning_tokens=r))


GOOD = '{"a": 1, "inner": {"x": 0.5}, "items": [], "note": "ok"}'
BAD = '{"a": "nope"}'


def make_router(tmp_path, scripts, **kw):
    """scripts: list of chunk lists (or Exceptions), consumed one per transport call."""
    r = NemotronRouter(client=NS(), store=TelemetryStore(tmp_path), **kw)
    r.seen = []

    @asynccontextmanager
    async def fake_open(model, kwargs):
        r.seen.append((model, kwargs))
        script = scripts.pop(0)
        if isinstance(script, Exception):
            raise script

        async def gen():
            for c in script:
                yield c

        yield {"x-ratelimit-limit-requests": "300", "x-ratelimit-remaining-requests": "299"}, gen()

    r._open = fake_open
    return r


MSGS = [{"role": "user", "content": "hi"}]


def test_strict_schema_inlines_and_requires_all():
    s = to_strict_schema(Out)
    assert "$defs" not in s and "$ref" not in str(s)
    assert s["additionalProperties"] is False and s["required"] == ["a", "inner", "items", "note"]
    assert s["properties"]["inner"]["additionalProperties"] is False
    assert s["properties"]["items"]["items"]["required"] == ["x"]


async def test_stream_parse_record_and_reasoning_order(tmp_path):
    stream = [
        chunk(reasoning="think "),
        chunk(reasoning="more"),
        chunk(content=GOOD[:20]),
        chunk(content=GOOD[20:]),
        chunk(usage=usage(100, 50, 30), choices=False),
    ]
    r = make_router(tmp_path, [stream])
    seen = []
    res = await r.call("ultra", MSGS, Out, thinking=True, on_reasoning=seen.append, role="ceo_a")
    assert seen == ["think ", "more"]
    assert res.parsed == Out(a=1, inner=Inner(x=0.5), note="ok") and not res.fallback_needed
    assert res.reasoning_text == "think more" and res.raw_text == GOOD
    rec = res.record
    assert (rec.prompt_tokens, rec.completion_tokens, rec.reasoning_tokens) == (100, 50, 30)
    assert rec.est_cost_usd == pytest.approx((100 * 1.0 + 50 * 3.0) / 1e6)
    assert rec.json_valid and rec.retries == 0 and rec.status == "ok" and rec.role == "ceo_a"
    _, kw = r.seen[0]
    assert kw["extra_body"] == {"chat_template_kwargs": {"enable_thinking": True}}
    assert kw["response_format"]["json_schema"]["strict"] is True
    assert kw["stream_options"] == {"include_usage": True} and kw["max_tokens"] == 3000
    assert len(list(tmp_path.glob("calls-*.jsonl"))) == 1


async def test_invalid_then_valid_retries_once(tmp_path):
    r = make_router(tmp_path, [
        [chunk(content=BAD), chunk(usage=usage(10, 5), choices=False)],
        [chunk(content=GOOD), chunk(usage=usage(20, 6), choices=False)],
    ])
    res = await r.call("super", MSGS, Out, thinking=False)
    assert res.parsed is not None and not res.fallback_needed
    assert res.record.retries == 1 and len(r.seen) == 2
    retry_msgs = r.seen[1][1]["messages"]
    assert retry_msgs[-2] == {"role": "assistant", "content": BAD} and "validation" in retry_msgs[-1]["content"]
    assert res.record.prompt_tokens == 30 and res.record.completion_tokens == 11


async def test_invalid_twice_needs_fallback(tmp_path):
    r = make_router(tmp_path, [[chunk(content=BAD)], [chunk(content="not json")]])
    res = await r.call("super", MSGS, Out, thinking=False)
    assert res.parsed is None and res.fallback_needed and res.record.fallback_used
    assert len(r.seen) == 2 and not res.record.json_valid


async def test_fast_tier_falls_back_to_nano_on_error(tmp_path):
    r = make_router(tmp_path, [RuntimeError("boom"), [chunk(content=GOOD), chunk(usage=usage(10, 5), choices=False)]])
    res = await r.call("fast", MSGS, Out, thinking=False)
    assert res.parsed is not None
    assert r.seen[0][0] == r.models["fast"] and r.seen[1][0] == r.models["fast_fallback"]
    assert res.record.retries == 1 and res.record.model == r.models["fast_fallback"]
    assert r.seen[0][1]["max_tokens"] == 800 and r.seen[0][1]["timeout"] == 5.0


async def test_ultra_error_has_no_model_swap(tmp_path):
    r = make_router(tmp_path, [RuntimeError("boom")])
    res = await r.call("ultra", MSGS, Out, thinking=True)
    assert res.fallback_needed and res.record.status == "error" and len(r.seen) == 1


async def test_limiter_waits_on_exhausted_bucket():
    now = [0.0]
    slept = []

    async def sleep(s):
        slept.append(s)
        now[0] += s

    rl = lim.RateLimiter({"m": (60, 6000)}, clock=lambda: now[0], sleep=sleep)
    for _ in range(60):
        await rl.acquire("m", 10)
    assert slept == []
    await rl.acquire("m", 10)  # RPM bucket empty: 1 req/s refill
    assert slept and slept[0] == pytest.approx(1.0)


async def test_limiter_sheds_fast_tier_when_low_and_honours_retry_after():
    now = [0.0]
    rl = lim.RateLimiter({"m": (100, 1_000_000)}, clock=lambda: now[0], sleep=lambda s: None)
    rl.update_from_headers("m", {"x-ratelimit-limit-requests": "100", "x-ratelimit-remaining-requests": "10"})
    with pytest.raises(lim.RateLimited):
        await rl.acquire("m", 1, sheddable=True)
    await rl.acquire("m", 1)  # ultra/super still go through
    rl.penalize("m", 5.0)
    with pytest.raises(lim.RateLimited):
        await rl.acquire("m", 1, sheddable=True)
    assert rl._get("m").blocked_until == pytest.approx(5.0)


def test_telemetry_shares_and_savings(tmp_path):
    store = TelemetryStore(tmp_path)
    specs = [("ultra", 1000, 2000), ("super", 3000, 400), ("fast", 1500, 600), ("fast", 1500, 600)]
    for tier, p, c in specs:
        store.add(CallRecord(tier=tier, model=tier, prompt_tokens=p, completion_tokens=c,
                             est_cost_usd=cost_usd(tier, p, c), ttft_ms=100.0 + p / 100, tok_per_s=50.0))
    store.add(CallRecord(tier="fast", model="f", status="shed"))
    snap = store.snapshot()
    assert snap["tiers"]["fast"]["calls"] == 2 and snap["call_share"] == {"ultra": 25.0, "super": 25.0, "fast": 50.0}
    total_tok = 3000 + 3400 + 2100 * 2
    assert snap["token_share"]["ultra"] == pytest.approx(100 * 3000 / total_tok, abs=0.1)
    cost = sum(cost_usd(t, p, c) for t, p, c in specs)
    all_ultra = sum((p * PRICES_PER_M["ultra"][0] + c * PRICES_PER_M["ultra"][1]) / 1e6 for _, p, c in specs)
    assert snap["cost_usd"] == pytest.approx(cost, abs=1e-6)
    assert snap["cost_all_ultra_usd"] == pytest.approx(all_ultra, abs=1e-6)
    assert snap["savings_pct"] == pytest.approx(100 * (1 - cost / all_ultra), abs=0.1)
    assert snap["job"]["status"] == "idle" and snap["tiers"]["ultra"]["p50_ttft_ms"] == 110.0


def test_spend_guard_trips_at_cap(tmp_path):
    store = TelemetryStore(tmp_path)
    guard = SpendGuard(0.10, tmp_path)
    assert guard.allow()
    store.add(CallRecord(tier="ultra", model="u", est_cost_usd=0.06))
    assert guard.allow() and guard.spent_today() == pytest.approx(0.06)
    store.add(CallRecord(tier="ultra", model="u", est_cost_usd=0.05))
    assert not guard.allow()


async def test_spend_guard_blocks_router_calls(tmp_path):
    store = TelemetryStore(tmp_path)
    store.add(CallRecord(tier="ultra", model="u", est_cost_usd=5.0))
    r = make_router(tmp_path, [], spend_guard=SpendGuard(1.0, tmp_path))
    res = await r.call("super", MSGS, Out, thinking=False)
    assert res.fallback_needed and res.record.status == "capped" and r.seen == []
