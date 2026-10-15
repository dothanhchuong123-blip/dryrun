"""Benchmark export built from the per-call telemetry logs (`telemetry/calls-*.jsonl`; SPEC §8, FEEDBACK prize).

Every number is aggregated from real call records. `build()` returns a dict, `to_markdown()` a readable table.
"""
from __future__ import annotations

import json
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Any

from backend.services.telemetry import TELEMETRY_DIR


def load_records(directory: Path | None = None) -> list[dict]:
    out: list[dict] = []
    for path in sorted((directory or TELEMETRY_DIR).glob("calls-*.jsonl")):
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            if isinstance(rec, dict):
                out.append(rec)
    return out


def _pct(values: list[float], q: float) -> float | None:
    if not values:
        return None
    s = sorted(values)
    return round(s[min(len(s) - 1, int(q * len(s)))], 1)


def _stats(recs: list[dict]) -> dict:
    ttft = [r["ttft_ms"] for r in recs if r.get("ttft_ms") is not None]
    total = [r["total_ms"] for r in recs if r.get("total_ms")]
    rate = [r["tok_per_s"] for r in recs if r.get("tok_per_s")]
    n = len(recs)
    return {
        "calls": n,
        "ok": sum(1 for r in recs if r.get("status") == "ok"),
        "errors": sum(1 for r in recs if r.get("status") not in ("ok", "shed", "capped")),
        "rate_limited": sum(int(r.get("n_429", 0)) for r in recs),
        "fallbacks": sum(1 for r in recs if r.get("fallback_used")),
        "json_valid_pct": round(100 * sum(1 for r in recs if r.get("json_valid")) / n, 1) if n else None,
        "tokens_in": sum(int(r.get("prompt_tokens", 0)) for r in recs),
        "tokens_out": sum(int(r.get("completion_tokens", 0)) for r in recs),
        "reasoning_tokens": sum(int(r.get("reasoning_tokens", 0)) for r in recs),
        "p50_ttft_ms": _pct(ttft, 0.5),
        "p50_total_ms": _pct(total, 0.5),
        "p95_total_ms": _pct(total, 0.95),
        "median_tok_per_s": round(statistics.median(rate), 1) if rate else None,
        "cost_usd": round(sum(float(r.get("est_cost_usd", 0.0)) for r in recs), 6),
    }


def build(directory: Path | None = None) -> dict[str, Any]:
    recs = load_records(directory)
    by_tier: dict[str, list[dict]] = defaultdict(list)
    by_role: dict[str, list[dict]] = defaultdict(list)
    for r in recs:
        by_tier[r.get("tier", "?")].append(r)
        by_role[f"{r.get('tier', '?')}/{r.get('role') or '-'}"].append(r)
    days = sorted({str(r.get("ts", ""))[:10] for r in recs if r.get("ts")})
    return {
        "records": len(recs),
        "days": days,
        "overall": _stats(recs),
        "by_tier": {k: _stats(v) for k, v in sorted(by_tier.items())},
        "by_role": {k: _stats(v) for k, v in sorted(by_role.items())},
    }


def to_markdown(report: dict[str, Any]) -> str:
    def row(name: str, s: dict) -> str:
        def f(v: Any) -> str:
            return "–" if v is None else str(v)
        return (f"| {name} | {s['calls']} | {s['errors']} | {s['rate_limited']} | {s['fallbacks']} | {f(s['p50_ttft_ms'])} | "
                f"{f(s['p50_total_ms'])} | {f(s['p95_total_ms'])} | {f(s['median_tok_per_s'])} | "
                f"{s['tokens_in']:,} | {s['tokens_out']:,} | ${s['cost_usd']:.4f} |")

    head = ("| | calls | errors | 429s | fallbacks | p50 TTFT ms | p50 total ms | p95 total ms | tok/s | tokens in | "
            "tokens out | cost |\n|---|---|---|---|---|---|---|---|---|---|---|---|")
    days = ", ".join(report["days"]) or "no data yet"
    out = ["# Benchmark export", "", f"{report['records']} real calls logged ({days}).", "", "## By tier", "", head]
    out += [row(k, v) for k, v in report["by_tier"].items()]
    out += ["", "## By role", "", head]
    out += [row(k, v) for k, v in report["by_role"].items()]
    out += ["", "## Overall", "", head, row("all", report["overall"]), ""]
    return "\n".join(out)
