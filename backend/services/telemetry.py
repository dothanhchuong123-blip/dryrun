"""Per-call telemetry records, cost estimates, spend caps, HUD aggregates.

See SPEC §8, §7.1. Every number the HUD shows is computed from these records.
"""
from __future__ import annotations

import json
import statistics
import threading
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel

from backend.config import PRICES_PER_M, ROOT

TELEMETRY_DIR = ROOT / "telemetry"
TIERS = ("ultra", "super", "fast")


def cost_usd(price_key: str, prompt_tokens: int, completion_tokens: int) -> float:
    p_in, p_out = PRICES_PER_M[price_key]
    return (prompt_tokens * p_in + completion_tokens * p_out) / 1e6


class CallRecord(BaseModel):
    ts: str = ""
    tier: str
    model: str
    role: str = ""
    ttft_ms: float | None = None
    total_ms: float = 0.0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    reasoning_tokens: int = 0
    tok_per_s: float | None = None
    status: str = "ok"  # ok | error | timeout | rate_limited | shed | capped
    retries: int = 0
    n_429: int = 0
    json_valid: bool = False
    fallback_used: bool = False
    est_cost_usd: float = 0.0

    def price_key(self) -> str:
        return self.tier


class TelemetryStore:
    def __init__(self, directory: Path | None = None, *, persist: bool = True) -> None:
        """`persist=False` keeps records in memory only (a per-analysis view, or tests)."""
        self.dir = directory or TELEMETRY_DIR
        self.persist = persist
        self.records: list[CallRecord] = []
        self.job: dict = {"id": None, "status": "idle"}
        self._lock = threading.Lock()

    def path_for(self, day: datetime | None = None) -> Path:
        return self.dir / f"calls-{(day or datetime.now(UTC)):%Y%m%d}.jsonl"

    def add(self, rec: CallRecord) -> None:
        if not rec.ts:
            rec.ts = datetime.now(UTC).isoformat()
        with self._lock:
            self.records.append(rec)
            if not self.persist:
                return
            self.dir.mkdir(parents=True, exist_ok=True)
            with self.path_for().open("a") as f:
                f.write(rec.model_dump_json() + "\n")

    def snapshot(self) -> dict:
        recs = [r for r in self.records if r.status != "shed"]
        tiers: dict[str, dict] = {}
        for t in TIERS:
            rs = [r for r in recs if r.tier == t]
            ttfts = [r.ttft_ms for r in rs if r.ttft_ms is not None]
            rates = [r.tok_per_s for r in rs if r.tok_per_s]
            tiers[t] = {
                "calls": len(rs),
                "tokens_in": sum(r.prompt_tokens for r in rs),
                "tokens_out": sum(r.completion_tokens for r in rs),
                "p50_ttft_ms": round(statistics.median(ttfts), 1) if ttfts else None,
                "tok_per_s": round(statistics.median(rates), 1) if rates else None,
                "errors": sum(1 for r in rs if r.status != "ok"),
            }
        n_calls = sum(v["calls"] for v in tiers.values())
        n_tok = sum(v["tokens_in"] + v["tokens_out"] for v in tiers.values())
        cost = sum(r.est_cost_usd for r in recs)
        all_ultra = sum(cost_usd("ultra", r.prompt_tokens, r.completion_tokens) for r in recs)
        return {
            "tiers": tiers,
            "call_share": {t: round(100 * v["calls"] / n_calls, 1) if n_calls else 0.0 for t, v in tiers.items()},
            "token_share": {
                t: round(100 * (v["tokens_in"] + v["tokens_out"]) / n_tok, 1) if n_tok else 0.0
                for t, v in tiers.items()
            },
            "cost_usd": round(cost, 6),
            "cost_all_ultra_usd": round(all_ultra, 6),
            "savings_pct": round(100 * (1 - cost / all_ultra), 1) if all_ultra else 0.0,
            "job": dict(self.job),
        }


class SpendGuard:
    """Blocks LIVE calls once today's spend (summed from the jsonl) reaches `cap` USD."""

    def __init__(self, cap: float, directory: Path | None = None) -> None:
        self.cap = cap
        self.dir = directory or TELEMETRY_DIR
        self._size = -1
        self._spent = 0.0

    def spent_today(self) -> float:
        path = self.dir / f"calls-{datetime.now(UTC):%Y%m%d}.jsonl"
        if not path.exists():
            return 0.0
        size = path.stat().st_size
        if size != self._size:
            total = 0.0
            for line in path.read_text().splitlines():
                try:
                    total += float(json.loads(line).get("est_cost_usd", 0.0))
                except (ValueError, TypeError):
                    continue
            self._size, self._spent = size, total
        return self._spent

    def allow(self) -> bool:
        return self.spent_today() < self.cap
