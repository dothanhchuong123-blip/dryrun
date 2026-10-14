"""Async Token Factory client per tier: strict json_schema, thinking toggle, reasoning stream, timeouts, fallbacks.

See SPEC §3.3, §5. The router returns decisions only; callers apply deterministic fallbacks when
`fallback_needed` is set.
"""
from __future__ import annotations

import asyncio
import copy
import json
import sys
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, Literal

import openai
from pydantic import BaseModel, ValidationError

from backend.config import get_settings
from backend.services.limiter import DEFAULT_LIMITS, RateLimited, RateLimiter
from backend.services.telemetry import CallRecord, SpendGuard, TelemetryStore, cost_usd

Tier = Literal["ultra", "super", "fast"]
DEFAULT_TIMEOUT: dict[str, float] = {"ultra": 30.0, "super": 10.0, "fast": 5.0}
DEFAULT_MAX_TOKENS: dict[str, int] = {"ultra": 3000, "super": 600, "fast": 800}
TEMPERATURE = 0.6
TOP_P = 0.95


def to_strict_schema(model: type[BaseModel]) -> dict:
    """Pydantic JSON schema -> OpenAI strict form: inline $defs, all props required, no extra props."""
    schema = model.model_json_schema()
    defs = schema.pop("$defs", {})

    def walk(node: Any) -> Any:
        if isinstance(node, list):
            return [walk(x) for x in node]
        if not isinstance(node, dict):
            return node
        if "$ref" in node:
            target = copy.deepcopy(defs[node["$ref"].rsplit("/", 1)[-1]])
            extra = {k: v for k, v in node.items() if k != "$ref"}
            return walk({**target, **extra})
        out = {k: walk(v) for k, v in node.items()}
        if out.get("type") == "object" or "properties" in out:
            props = out.setdefault("properties", {})
            out["required"] = list(props)
            out["additionalProperties"] = False
        return out

    return walk(schema)


@dataclass
class CallResult:
    parsed: BaseModel | None
    raw_text: str
    reasoning_text: str
    record: CallRecord
    fallback_needed: bool


@dataclass
class _Attempt:
    text: str = ""
    reasoning: str = ""
    ttft_ms: float | None = None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    reasoning_tokens: int = 0
    stream_ms: float = 0.0


class _CallError(Exception):
    def __init__(self, status: str, retry_after: float | None = None) -> None:
        super().__init__(status)
        self.status = status
        self.retry_after = retry_after


def _estimate_tokens(messages: list[dict], max_tokens: int) -> int:
    chars = sum(len(str(m.get("content", ""))) for m in messages)
    return chars // 4 + max_tokens


class NemotronRouter:
    def __init__(
        self,
        *,
        client: openai.AsyncOpenAI | None = None,
        limiter: RateLimiter | None = None,
        store: TelemetryStore | None = None,
        spend_guard: SpendGuard | None = None,
    ) -> None:
        s = get_settings()
        self.settings = s
        self.client = client or openai.AsyncOpenAI(
            base_url=s.nebius_base_url, api_key=s.nebius_api_key.get_secret_value() or "missing", max_retries=0
        )
        self.models = {
            "ultra": s.model_ultra,
            "super": s.model_super,
            "fast": s.model_fast,
            "fast_fallback": s.model_fast_fallback,
        }
        self.limiter = limiter or RateLimiter({self.models[k]: v for k, v in DEFAULT_LIMITS.items()})
        self.store = store or TelemetryStore()
        self.spend_guard = spend_guard

    # --- transport (patched in tests) -------------------------------------------------
    @asynccontextmanager
    async def _open(self, model: str, kwargs: dict) -> AsyncIterator[tuple[dict, AsyncIterator]]:
        async with self.client.chat.completions.with_streaming_response.create(model=model, **kwargs) as resp:
            yield dict(resp.headers.items()), await resp.parse()

    async def _stream_once(
        self, model: str, messages: list[dict], schema: type[BaseModel], thinking: bool, max_tokens: int,
        timeout: float, on_reasoning: Callable[[str], Awaitable[None] | None] | None,
    ) -> _Attempt:
        kwargs = {
            "messages": messages,
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": schema.__name__, "strict": True, "schema": to_strict_schema(schema)},
            },
            "max_tokens": max_tokens,
            "temperature": TEMPERATURE,
            "top_p": TOP_P,
            "stream": True,
            "stream_options": {"include_usage": True},
            "extra_body": {"chat_template_kwargs": {"enable_thinking": thinking}},
            "timeout": timeout,
        }
        att = _Attempt()
        content: list[str] = []
        reasoning: list[str] = []
        t0 = time.perf_counter()

        async def consume() -> None:
            async with self._open(model, kwargs) as (headers, chunks):
                self.limiter.update_from_headers(model, headers)
                async for chunk in chunks:
                    if getattr(chunk, "usage", None):
                        u = chunk.usage
                        att.prompt_tokens = u.prompt_tokens or 0
                        att.completion_tokens = u.completion_tokens or 0
                        d = getattr(u, "completion_tokens_details", None)
                        att.reasoning_tokens = (getattr(d, "reasoning_tokens", 0) or 0) if d else 0
                    if not chunk.choices:
                        continue
                    delta = chunk.choices[0].delta
                    extra = getattr(delta, "model_extra", None) or {}
                    r = extra.get("reasoning_content") or extra.get("reasoning")
                    if r:
                        if att.ttft_ms is None:
                            att.ttft_ms = (time.perf_counter() - t0) * 1000
                        reasoning.append(r)
                        if on_reasoning:
                            res = on_reasoning(r)
                            if asyncio.iscoroutine(res):
                                await res
                    if delta.content:
                        if att.ttft_ms is None:
                            att.ttft_ms = (time.perf_counter() - t0) * 1000
                        content.append(delta.content)

        try:
            await asyncio.wait_for(consume(), timeout)
        except TimeoutError as e:
            raise _CallError("timeout") from e
        except openai.RateLimitError as e:
            ra = e.response.headers.get("retry-after") if getattr(e, "response", None) else None
            try:
                wait = float(ra) if ra else 2.0
            except ValueError:
                wait = 2.0
            raise _CallError("rate_limited", wait) from e
        except openai.APITimeoutError as e:
            raise _CallError("timeout") from e
        except Exception as e:
            raise _CallError("error") from e
        finally:
            att.text, att.reasoning = "".join(content), "".join(reasoning)
            att.stream_ms = (time.perf_counter() - t0) * 1000
        return att

    # --- public API -------------------------------------------------------------------
    async def call(
        self,
        tier: Tier,
        messages: list[dict],
        schema: type[BaseModel],
        *,
        thinking: bool,
        max_tokens: int | None = None,
        timeout: float | None = None,
        on_reasoning: Callable[[str], Awaitable[None] | None] | None = None,
        role: str = "",
    ) -> CallResult:
        max_tokens = max_tokens or DEFAULT_MAX_TOKENS[tier]
        timeout = timeout or DEFAULT_TIMEOUT[tier]
        model_key = tier
        model = self.models[model_key]
        rec = CallRecord(tier=tier, model=model, role=role)
        t_start = time.perf_counter()
        parsed: BaseModel | None = None
        text = reasoning = ""
        cost = 0.0
        msgs = list(messages)

        def finish(fallback: bool) -> CallResult:
            rec.total_ms = round((time.perf_counter() - t_start) * 1000, 1)
            rec.est_cost_usd = round(cost, 8)
            rec.fallback_used = fallback
            rec.json_valid = parsed is not None
            if rec.completion_tokens and rec.ttft_ms is not None:
                gen_s = max(rec.total_ms - rec.ttft_ms, 1.0) / 1000
                rec.tok_per_s = round(rec.completion_tokens / gen_s, 1)
            rec.ttft_ms = round(rec.ttft_ms, 1) if rec.ttft_ms is not None else None
            self.store.add(rec)
            return CallResult(parsed, text, reasoning, rec, fallback)

        if self.spend_guard and not self.spend_guard.allow():
            rec.status = "capped"
            return finish(True)

        validation_retried = False
        transport_retried = False
        while True:
            est = _estimate_tokens(msgs, max_tokens)
            try:
                await self.limiter.acquire(model, est, sheddable=(tier == "fast"))
            except RateLimited:
                rec.status = "shed"
                return finish(True)
            try:
                att = await self._stream_once(model, msgs, schema, thinking, max_tokens, timeout, on_reasoning)
            except _CallError as e:
                self.limiter.settle(model, est, 0)
                rec.status = e.status
                if e.status == "rate_limited":
                    rec.n_429 += 1
                    self.limiter.penalize(model, e.retry_after or 2.0)
                if tier == "fast" and not transport_retried:
                    transport_retried = True
                    rec.retries += 1
                    model_key = "fast_fallback"
                    model = self.models[model_key]
                    rec.model = model
                    continue
                if e.status == "rate_limited" and not transport_retried and tier != "fast":
                    transport_retried = True
                    rec.retries += 1
                    continue
                return finish(True)
            else:
                self.limiter.settle(model, est, att.prompt_tokens + att.completion_tokens)
                rec.prompt_tokens += att.prompt_tokens
                rec.completion_tokens += att.completion_tokens
                rec.reasoning_tokens += att.reasoning_tokens
                cost += cost_usd(model_key if model_key == "fast_fallback" else tier,
                                 att.prompt_tokens, att.completion_tokens)
                if rec.ttft_ms is None:
                    rec.ttft_ms = att.ttft_ms
                text, reasoning = att.text, att.reasoning
                rec.status = "ok"
            try:
                parsed = schema.model_validate_json(text)
                return finish(False)
            except ValidationError as e:
                if validation_retried:
                    return finish(True)
                validation_retried = True
                rec.retries += 1
                err = json.dumps(e.errors(include_url=False, include_context=False), default=str)[:800]
                msgs = [
                    *messages,
                    {"role": "assistant", "content": text},
                    {"role": "user", "content": f"Your reply failed validation: {err}\nReply again with corrected JSON only."},
                ]


async def _smoke() -> None:
    class Ping(BaseModel):
        answer: int
        note: str

    router = NemotronRouter()
    for tier in ("super", "fast"):
        res = await router.call(
            tier,
            [{"role": "user", "content": 'What is 2+3? Reply as JSON {"answer": <int>, "note": "<=5 words"}.'}],
            Ping,
            thinking=False,
            max_tokens=100,
            role="smoke",
        )
        r = res.record
        print(f"{tier}: parsed={res.parsed} status={r.status} ttft={r.ttft_ms}ms total={r.total_ms}ms "
              f"tokens={r.prompt_tokens}/{r.completion_tokens} cost=${r.est_cost_usd:.6f}")
    print(json.dumps(router.store.snapshot(), indent=2))


if __name__ == "__main__":
    if "--smoke" in sys.argv:
        asyncio.run(_smoke())
    else:
        sys.exit("usage: python -m backend.services.router --smoke")
