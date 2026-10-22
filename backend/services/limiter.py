"""Per-model rate limiter driven by x-ratelimit-* headers, Retry-After, tier priority.

See SPEC §3.2. One async token bucket per model for requests (RPM) and tokens (TPM).
"""
from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable, Mapping

SHED_BELOW = 0.20  # fast-tier calls are rejected when either bucket is under 20% full


class RateLimited(Exception):
    """Raised for low-priority calls that should use their deterministic fallback instead of waiting."""


class TokenBucket:
    def __init__(self, per_minute: float, clock: Callable[[], float] = time.monotonic) -> None:
        self.capacity = float(per_minute)
        self.tokens = float(per_minute)
        self._clock = clock
        self._last = clock()

    @property
    def rate(self) -> float:  # tokens per second
        return self.capacity / 60.0

    def _refill(self) -> None:
        now = self._clock()
        self.tokens = min(self.capacity, self.tokens + (now - self._last) * self.rate)
        self._last = now

    def fraction(self) -> float:
        self._refill()
        return self.tokens / self.capacity if self.capacity else 0.0

    def wait_needed(self, n: float) -> float:
        """Seconds until `n` tokens are available (0 if available now)."""
        self._refill()
        n = min(n, self.capacity)
        return 0.0 if self.tokens >= n else (n - self.tokens) / self.rate

    def take(self, n: float) -> None:
        self._refill()
        self.tokens -= min(n, self.capacity)

    def refund(self, n: float) -> None:
        self._refill()
        self.tokens = min(self.capacity, self.tokens + n)

    def sync(self, limit: float | None, remaining: float | None) -> None:
        self._refill()
        if limit and limit > 0:
            self.capacity = float(limit)
        if remaining is not None:
            self.tokens = min(self.capacity, float(remaining))


class _Model:
    def __init__(self, rpm: float, tpm: float, clock: Callable[[], float]) -> None:
        self.rpm = TokenBucket(rpm, clock)
        self.tpm = TokenBucket(tpm, clock)
        self.blocked_until = 0.0


# Starting values (SPEC §3.3 / Day-1 measurements); replaced by x-ratelimit headers once seen.
DEFAULT_LIMITS: dict[str, tuple[float, float]] = {
    "ultra": (300, 200_000),
    "super": (300, 200_000),
    "fast": (600, 400_000),
    "fast_fallback": (100, 800_000),
    "vision": (60, 100_000),
}


class RateLimiter:
    def __init__(
        self,
        limits_by_model: Mapping[str, tuple[float, float]],
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._clock = clock
        self._sleep = sleep
        self._models = {m: _Model(rpm, tpm, clock) for m, (rpm, tpm) in limits_by_model.items()}

    def _get(self, model: str) -> _Model:
        if model not in self._models:
            self._models[model] = _Model(300, 200_000, self._clock)
        return self._models[model]

    async def acquire(self, model: str, est_tokens: int, *, sheddable: bool = False) -> None:
        """Wait for capacity. Sheddable (fast-tier) calls raise RateLimited instead when a bucket is low."""
        m = self._get(model)
        while True:
            now = self._clock()
            if sheddable and (
                m.blocked_until > now or m.rpm.fraction() < SHED_BELOW or m.tpm.fraction() < SHED_BELOW
            ):
                raise RateLimited(model)
            wait = max(m.blocked_until - now, m.rpm.wait_needed(1), m.tpm.wait_needed(est_tokens))
            if wait <= 0:
                break
            await self._sleep(wait)
        m.rpm.take(1)
        m.tpm.take(est_tokens)

    def settle(self, model: str, est_tokens: int, actual_tokens: int) -> None:
        """Return the unused part of the up-front token reservation."""
        if actual_tokens < est_tokens:
            self._get(model).tpm.refund(est_tokens - actual_tokens)

    def update_from_headers(self, model: str, headers: Mapping[str, str]) -> None:
        h = {k.lower(): v for k, v in headers.items()}
        m = self._get(model)

        def num(key: str) -> float | None:
            try:
                return float(h[key])
            except (KeyError, ValueError):
                return None

        m.rpm.sync(num("x-ratelimit-limit-requests"), num("x-ratelimit-remaining-requests"))
        m.tpm.sync(num("x-ratelimit-limit-tokens"), num("x-ratelimit-remaining-tokens"))

    def penalize(self, model: str, retry_after: float) -> None:
        """Honour a 429 Retry-After: nothing goes to this model until it elapses."""
        m = self._get(model)
        m.blocked_until = max(m.blocked_until, self._clock() + max(retry_after, 0.0))
