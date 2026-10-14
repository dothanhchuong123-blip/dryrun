# /// script
# requires-python = ">=3.11"
# dependencies = ["openai>=1.40"]
# ///
"""Day-1 Token Factory check (SPEC §13).

1. Lists Nemotron model IDs on each known Token Factory base URL.
2. Sends one tiny strict-json_schema request per tier (thinking on/off) and records
   TTFT, latency, tokens, tok/s, rate-limit headers, where reasoning text arrives, JSON validity.

Reads NEBIUS_API_KEY (+ optional NEBIUS_BASE_URL, MODEL_*) from .env. Never prints the key.
Hard spend cap: SPEND_CAP_USD (estimated from token usage).

    uv run scripts/day1_check.py              # all tiers
    uv run scripts/day1_check.py --skip-ultra # cheap run
"""
import json
import os
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

from openai import OpenAI

ROOT = Path(__file__).resolve().parent.parent
BASE_URLS = [
    "https://api.tokenfactory.nebius.com/v1/",
    "https://api.tokenfactory.us-central1.nebius.com/v1/",
]
# USD per 1M tokens (input, output) — Nebius Nemotron pricing page, checked 2026-10-14
PRICES = {"ultra": (1.00, 3.00), "super": (0.30, 0.90), "nano": (0.06, 0.24), "lightning": (0.06, 0.24)}
SPEND_CAP_USD = 0.25

SCHEMA = {
    "name": "pricing_decision",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "price": {"type": "number"},
            "action": {"type": "string", "enum": ["cut", "hold", "raise"]},
            "reason": {"type": "string"},
        },
        "required": ["price", "action", "reason"],
        "additionalProperties": False,
    },
}
PROMPT = (
    "You are the CEO of Firm A. Your price is $100, marginal cost $60. "
    "Rival Firm B just cut its price 10% to $90, and raw-material cost rose 25%. "
    "Decide Firm A's next price. Reply only with JSON: "
    '{"price": number, "action": "cut"|"hold"|"raise", "reason": "<=20 words"}'
)


def load_env() -> None:
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            if v.strip():
                os.environ.setdefault(k.strip(), v.strip().strip("\"'"))


def list_nemotron(key: str) -> dict[str, list[str]]:
    found = {}
    for url in BASE_URLS:
        try:
            ids = [m.id for m in OpenAI(base_url=url, api_key=key).models.list()]
            found[url] = sorted(i for i in ids if "nemotron" in i.lower())
            print(f"\n[{url}] {len(ids)} models, Nemotron:")
            for i in found[url]:
                print("   ", i)
        except Exception as e:  # noqa: BLE001
            print(f"\n[{url}] unavailable: {type(e).__name__}: {str(e)[:160]}")
    return found


def pick(ids: list[str], tier: str) -> str | None:
    env = {"ultra": "MODEL_ULTRA", "super": "MODEL_SUPER"}.get(tier)
    if env and os.environ.get(env) in ids:
        return os.environ[env]
    for i in ids:
        low = i.lower()
        if tier == "lightning" and "lightning" in low:
            return i
        if tier == "nano" and "nano" in low and "omni" not in low and "lightning" not in low:
            return i
        if tier in ("ultra", "super") and tier in low:
            return i
    return None


def probe(client: OpenAI, tier: str, model: str, thinking: bool, max_tokens: int) -> dict:
    rec = {"tier": tier, "model": model, "thinking": thinking}
    t0 = time.perf_counter()
    first_any = first_content = None
    content, reasoning, usage, headers = [], [], None, {}
    try:
        with client.chat.completions.with_streaming_response.create(
            model=model,
            messages=[{"role": "user", "content": PROMPT}],
            response_format={"type": "json_schema", "json_schema": SCHEMA},
            max_tokens=max_tokens,
            temperature=0.6,
            top_p=0.95,
            stream=True,
            stream_options={"include_usage": True},
            extra_body={"chat_template_kwargs": {"enable_thinking": thinking}},
            timeout=120,
        ) as resp:
            headers = {k: v for k, v in resp.headers.items() if k.lower().startswith("x-ratelimit")}
            for chunk in resp.parse():
                if chunk.usage:
                    usage = chunk.usage
                if not chunk.choices:
                    continue
                d = chunk.choices[0].delta
                extra = d.model_extra or {}
                r = extra.get("reasoning_content") or extra.get("reasoning")
                now = time.perf_counter()
                if r:
                    reasoning.append(r)
                    first_any = first_any or now
                if d.content:
                    content.append(d.content)
                    first_any = first_any or now
                    first_content = first_content or now
    except Exception as e:  # noqa: BLE001
        rec["error"] = f"{type(e).__name__}: {str(e)[:300]}"
        return rec

    total = time.perf_counter() - t0
    text = "".join(content)
    try:
        json.loads(text)
        rec["json_valid"] = True
    except json.JSONDecodeError:
        rec["json_valid"] = False
    p_tok = usage.prompt_tokens if usage else None
    c_tok = usage.completion_tokens if usage else None
    details = getattr(usage, "completion_tokens_details", None) if usage else None
    p_in, p_out = PRICES[tier]
    rec.update(
        ttft_ms=round((first_any - t0) * 1000) if first_any else None,
        ttfc_ms=round((first_content - t0) * 1000) if first_content else None,
        total_ms=round(total * 1000),
        prompt_tokens=p_tok,
        completion_tokens=c_tok,
        reasoning_tokens=getattr(details, "reasoning_tokens", None) if details else None,
        tok_per_s=round(c_tok / max(total - (first_any - t0 if first_any else 0), 1e-3), 1) if c_tok else None,
        reasoning_field_chars=len("".join(reasoning)),
        reasoning_inline_think_tag="<think>" in text,
        est_cost_usd=round(((p_tok or 0) * p_in + (c_tok or 0) * p_out) / 1e6, 6),
        ratelimit_headers=headers,
        content_preview=text[:200],
    )
    return rec


def main() -> None:
    load_env()
    key = os.environ.get("NEBIUS_API_KEY")
    if not key:
        sys.exit("NEBIUS_API_KEY missing — add it to .env (see .env.example).")
    print(f"Key loaded ({len(key)} chars).")

    found = list_nemotron(key)
    base = os.environ.get("NEBIUS_BASE_URL") or BASE_URLS[0]
    if base not in found or not found[base]:
        base = next((u for u, ids in found.items() if ids), None)
    if not base:
        sys.exit("No Nemotron models visible on any base URL.")
    ids = found[base]
    print(f"\nUsing base URL: {base}")
    client = OpenAI(base_url=base, api_key=key, max_retries=0)

    plan = [("super", False, 400), ("nano", False, 400), ("lightning", False, 400), ("ultra", False, 400)]
    if "--skip-ultra" not in sys.argv:
        plan.append(("ultra", True, 4096))

    results, spent = [], 0.0
    for tier, thinking, max_tok in plan:
        model = pick(ids, tier)
        if not model:
            print(f"\n- {tier}: no matching model on this base URL")
            continue
        if spent >= SPEND_CAP_USD:
            print(f"\nSpend cap ${SPEND_CAP_USD} reached — stopping.")
            break
        print(f"\n- {tier} ({model}) thinking={thinking} ...", flush=True)
        rec = probe(client, tier, model, thinking, max_tok)
        spent += rec.get("est_cost_usd", 0) or 0
        results.append(rec)
        print(json.dumps({k: v for k, v in rec.items() if k != "model"}, indent=2))

    out = ROOT / "bench" / "results" / f"day1_check_{datetime.now(UTC):%Y%m%dT%H%M%SZ}.json"
    out.write_text(json.dumps({"base_url": base, "nemotron_ids": found, "results": results}, indent=2))
    print(f"\nEstimated spend: ${spent:.4f}. Saved {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
