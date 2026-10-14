# /// script
# requires-python = ">=3.11"
# dependencies = ["openai>=1.40", "pydantic>=2.8", "pydantic-settings>=2.4", "numpy>=2.0"]
# ///
"""Live check of each T05 prompt against its real model (hard cap $0.05 est.).

    uv run scripts/try_prompts.py [--skip-ultra]

Reads NEBIUS_API_KEY / model IDs via backend.config. Never prints the key.
Saves bench/results/prompts_try_<ts>.json.
"""
import json
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from openai import OpenAI

from backend.agents import prompts, schemas
from backend.config import PRICES_PER_M, get_settings

CAP_USD = 0.05
ARCH = json.loads((ROOT / "fixtures" / "archetypes.json").read_text())

ARTICLE = {
    "url": "https://example.com/tariff",
    "title": "US announces 25% tariff on imported semiconductors",
    "content": "The administration said a 25% tariff on semiconductors takes effect next month. "
    "Freight carriers warned of delays of up to two weeks at major ports.",
}
ROW = {"p_self": 100, "p_rival": 92, "s_self": 120, "s_rival": 140, "inv_self": 200, "inv_rival": 150,
       "pi_self": 2500, "pi_rival": 2900}
STATE = {"tick": 24, "horizon": 120, "mc": 62, "atc": 78, "c_raw": 62, "lead_time": 5, "capacity": 300,
         "own_price": 100, "own_inventory": 200, "history": [{"tick": 16 + i, **ROW} for i in range(8)],
         "shock": {"headline": "25% tariff on semiconductors", "quotes": ["a 25% tariff on semiconductors"]}}


def strict(model) -> dict:
    schema = model.model_json_schema()
    defs = schema.pop("$defs", {})

    def walk(n):
        if isinstance(n, dict):
            if "$ref" in n:
                return walk(defs[n["$ref"].split("/")[-1]])
            n = {k: walk(v) for k, v in n.items()}
            if n.get("type") == "object":
                n["additionalProperties"] = False
                n["required"] = list(n.get("properties", {}))
            return n
        if isinstance(n, list):
            return [walk(x) for x in n]
        return n

    return {"name": model.__name__, "strict": True, "schema": walk(schema)}


def call(client, tier, model_id, messages, schema_model, thinking, max_tokens, timeout):
    t0 = time.perf_counter()
    rec = {"tier": tier, "model": model_id, "thinking": thinking}
    try:
        r = client.chat.completions.create(
            model=model_id, messages=messages, max_tokens=max_tokens, temperature=0.6, top_p=0.95,
            response_format={"type": "json_schema", "json_schema": strict(schema_model)},
            extra_body={"chat_template_kwargs": {"enable_thinking": thinking}}, timeout=timeout,
        )
    except Exception as e:  # noqa: BLE001
        rec["error"] = f"{type(e).__name__}: {str(e)[:300]}"
        return rec
    rec["latency_ms"] = round((time.perf_counter() - t0) * 1000)
    content = r.choices[0].message.content or ""
    u = r.usage
    det = getattr(u, "completion_tokens_details", None)
    pin, pout = PRICES_PER_M[tier]
    rec.update(
        prompt_tokens=u.prompt_tokens, completion_tokens=u.completion_tokens,
        reasoning_tokens=getattr(det, "reasoning_tokens", None) if det else None,
        est_cost_usd=round((u.prompt_tokens * pin + u.completion_tokens * pout) / 1e6, 6),
        content=content,
    )
    try:
        schema_model.model_validate_json(content)
        rec["valid"] = True
    except Exception as e:  # noqa: BLE001
        rec["valid"] = False
        rec["validation_error"] = str(e)[:300]
    return rec


def main() -> None:
    s = get_settings()
    key = s.nebius_api_key.get_secret_value()
    if not key:
        sys.exit("NEBIUS_API_KEY missing in .env")
    print(f"Key loaded ({len(key)} chars).")
    client = OpenAI(base_url=s.nebius_base_url, api_key=key, max_retries=0)
    S = schemas
    plan = [
        ("fast", s.model_fast, prompts.crowd_messages(ARCH[:6], {"price_A": 100, "price_B": 92, "news": "tariff"}),
         S.CrowdBatch, False, 800, 5 + 25),
        ("super", s.model_super, prompts.shock_parser_messages([ARTICLE], "tariff scenario"), S.ShockVector, False, 600, 30),
        ("super", s.model_super, prompts.inventory_messages("A", {"inventory": 200, "rop": 350, "lead_time": 5}, {"delta_lead_time": 3}),
         S.InventoryDecision, False, 300, 30),
        ("super", s.model_super, prompts.scout_query_messages("margin fell 18% over 3 ticks with no known cause"),
         S.ScoutQuery, False, 100, 30),
    ]
    if "--skip-ultra" not in sys.argv:
        plan.append(("ultra", s.model_ultra, prompts.ceo_messages("A", STATE, [{"action": "cut", "price": 92}], {"ne": "cut/cut"}),
                     S.CEODecision, True, 3000, 90))
    results, spent = [], 0.0
    for tier, mid, msgs, model, thinking, mx, to in plan:
        if spent >= CAP_USD:
            print("Spend cap reached")
            break
        print(f"- {model.__name__} on {tier} ...", flush=True)
        rec = call(client, tier, mid, msgs, model, thinking, mx, to)
        rec["schema"] = model.__name__
        spent += rec.get("est_cost_usd", 0) or 0
        results.append(rec)
        print({k: v for k, v in rec.items() if k not in ("model",)})
    out = ROOT / "bench" / "results" / f"prompts_try_{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}.json"
    out.write_text(json.dumps({"est_total_usd": round(spent, 5), "results": results}, indent=2))
    print(f"\nest total ${spent:.4f} -> {out}")


if __name__ == "__main__":
    main()
