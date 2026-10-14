import json
from pathlib import Path

import numpy as np
import pytest
from pydantic import BaseModel, ValidationError

from backend.agents import prompts, schemas
from backend.agents.schemas import (
    ArchetypeSentiment,
    CEODecision,
    CrowdBatch,
    Evidence,
    InventoryDecision,
    ScoutQuery,
    ShockVector,
)

ROOT = Path(__file__).resolve().parent.parent
ARCH = json.loads((ROOT / "fixtures" / "archetypes.json").read_text())


def to_strict_schema(model: type[BaseModel]) -> dict:
    """Local copy until T04's router lands: inline $defs, forbid extra props, require all fields."""
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

    return walk(schema)


def _sentiment(i):
    return ArchetypeSentiment(id=i, mu_a=0.2, mu_b=-0.1, sigma_a=0.1, sigma_b=0.2, bubble="Cheap is good!")


SAMPLES = [
    Evidence(quote="25% tariff", url="https://x.com/a"),
    ShockVector(delta_c_raw=0.25, delta_lead_time=3, demand_shock=-0.1, severity=0.6,
                evidence=[Evidence(quote="25% tariff", url="https://x.com/a")]),
    InventoryDecision(omega=0.5, rationale="buffer"),
    CEODecision(price=100, production_qty=200, marketing_budget=50, expected_rival_action="hold", rationale="r"),
    _sentiment(1),
    CrowdBatch(archetypes=[_sentiment(i) for i in range(1, 7)]),
    ScoutQuery(query="red sea shipping disruption"),
]


@pytest.mark.parametrize("obj", SAMPLES, ids=lambda o: type(o).__name__)
def test_schema_strict_and_roundtrip(obj):
    s = to_strict_schema(type(obj))
    assert s["additionalProperties"] is False
    assert "$ref" not in json.dumps(s)
    assert type(obj).model_validate_json(obj.model_dump_json()) == obj


def test_bounds_reject():
    with pytest.raises(ValidationError):
        InventoryDecision(omega=3.0, rationale="x")
    with pytest.raises(ValidationError):
        ArchetypeSentiment(id=13, mu_a=0, mu_b=0, sigma_a=0, sigma_b=0, bubble="x")
    with pytest.raises(ValidationError):
        ArchetypeSentiment(id=1, mu_a=0, mu_b=0, sigma_a=0, sigma_b=0, bubble="x" * 61)


def test_ceo_clamping_and_pair():
    wild = CEODecision(price=1000, production_qty=9999, marketing_budget=5, expected_rival_action="cut", rationale="")
    low = CEODecision(price=1, production_qty=10, marketing_budget=0, expected_rival_action="raise", rationale="")
    fd = schemas.ceo_pair_to_decision(wild, low, mc=(60, 60), atc=(80, 80), capacity=(300, 300))
    assert fd.price.tolist() == [320.0, 30.0]
    assert fd.production_plan.tolist() == [300.0, 10.0]
    assert fd.marketing.tolist() == [5.0, 0.0]


def test_crowd_to_sentiment():
    b1 = CrowdBatch(archetypes=[_sentiment(i) for i in range(1, 7)])
    b2 = CrowdBatch(archetypes=[_sentiment(i) for i in range(7, 13)])
    cs = schemas.crowd_to_sentiment([b1, b2])
    assert cs.mu.shape == (12, 2) and cs.sigma.shape == (12, 2)
    assert np.allclose(cs.mu[11], [0.2, -0.1])
    partial = schemas.crowd_to_sentiment([b1])
    assert np.allclose(partial.mu[8], 0)


def test_shock_to_engine():
    sh = schemas.shock_to_engine(SAMPLES[1])
    assert (sh.delta_c_raw, sh.delta_lead_time, sh.demand_shock) == (0.25, 3, -0.1)


def test_archetypes_fixture_order():
    assert [a["id"] for a in ARCH] == list(range(1, 13))
    expect = [(i, s, l) for i in ("low", "mid", "high") for s in ("hunter", "moderate") for l in ("A", "B")]
    assert [(a["income"], a["sensitivity"], a["loyalty"]) for a in ARCH] == expect
    from backend.engine.market import make_archetypes
    assert [a["label"] for a in ARCH] == make_archetypes(120, np.random.default_rng(0)).labels


def _tokens(msgs):
    return sum(len(m["content"]) for m in msgs) / 4


def test_prompt_sizes():
    row = {"p_self": 100, "p_rival": 95, "s_self": 120, "s_rival": 130, "inv_self": 200, "inv_rival": 180,
           "pi_self": 3000, "pi_rival": 3100}
    hist = [{"tick": t, **row} for t in range(30)]
    state = {"tick": 30, "horizon": 120, "mc": 60, "atc": 75, "c_raw": 62, "lead_time": 5, "capacity": 300,
             "own_price": 100, "own_inventory": 200, "history": hist,
             "shock": {"headline": "Tariff", "quotes": ["25% tariff"] * 3}}
    ceo = prompts.ceo_messages("A", state, [{"action": "cut", "price": 90}] * 8, {"ne": "hold/hold"})
    assert "SHORT" in ceo[0]["content"] and ceo[1]["content"].count("\n") < 30
    assert _tokens(ceo) < 1500 + 600
    arts = [{"url": "https://x", "title": "t", "content": "word " * 5000}] * 2
    for m in (
        ceo,
        prompts.shock_parser_messages(arts, "tariff"),
        prompts.inventory_messages("A", {"inv": 1}, None),
        prompts.crowd_messages(ARCH[:6], {"pA": 100, "pB": 95}),
        prompts.scout_query_messages("margin fell 20%"),
    ):
        assert _tokens(m) < 6000
        assert [x["role"] for x in m] == ["system", "user"]
