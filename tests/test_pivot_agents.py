import json
import re
from pathlib import Path

import pytest
from pydantic import ValidationError

from backend.agents import prompts
from backend.agents.schemas import AnalystStep, BusinessProfile, MemoDraft, PlanSpecModel
from backend.services.router import to_strict_schema

ROOT = Path(__file__).resolve().parent.parent
ARCH = json.loads((ROOT / "fixtures" / "archetypes.json").read_text())
EXAMPLES = {p.stem: json.loads(p.read_text()) for p in sorted((ROOT / "fixtures" / "examples").glob("*.json"))}

# SPEC §15.4 field list (the engine's PlanSpec uses the same keys)
PLAN_FIELDS = {
    "name", "price_change_pct", "price_change_week", "extra_stock_weeks", "stock_week", "marketing_change_pct",
    "switch_supplier", "alt_cost_change_pct", "alt_lead_time_weeks", "alt_shock_exposure",
}


def _plan(name="Stock up 4 wk", **kw) -> PlanSpecModel:
    base = {
        "name": name, "price_change_pct": 3, "price_change_week": 3, "extra_stock_weeks": 4, "stock_week": 0,
        "marketing_change_pct": 0, "switch_supplier": False, "alt_cost_change_pct": 0, "alt_lead_time_weeks": 3,
        "alt_shock_exposure": 0.3,
    }
    return PlanSpecModel(**{**base, **kw})


def _profile() -> dict:
    return EXAMPLES["coffee_hcmc"]["profile"]


@pytest.mark.parametrize("model", [BusinessProfile, PlanSpecModel, AnalystStep, MemoDraft])
def test_strict_schema_is_flat(model):
    s = to_strict_schema(model)
    text = json.dumps(s)
    assert s["additionalProperties"] is False
    assert "$ref" not in text and "anyOf" not in text and "oneOf" not in text
    assert set(s["required"]) == set(s["properties"])


def test_bounds_reject():
    with pytest.raises(ValidationError):
        _plan(price_change_pct=25)
    with pytest.raises(ValidationError):
        _plan(price_change_week=24)
    with pytest.raises(ValidationError):
        _plan(extra_stock_weeks=9)
    with pytest.raises(ValidationError):
        _plan(alt_shock_exposure=1.5)
    with pytest.raises(ValidationError):
        _plan(name="x" * 41)
    with pytest.raises(ValidationError):
        BusinessProfile(**{**_profile(), "lead_time_weeks": 17})
    with pytest.raises(ValidationError):
        BusinessProfile(**{**_profile(), "guessed_fields": ["business_name"]})
    with pytest.raises(ValidationError):
        BusinessProfile(**{**_profile(), "search_terms": []})
    with pytest.raises(ValidationError):
        AnalystStep(thought="t", action="test", plans=[_plan(f"p{i}") for i in range(4)], pick="p", why="w")
    with pytest.raises(ValidationError):
        AnalystStep(thought="t", action="maybe", plans=[], pick="p", why="w")
    with pytest.raises(ValidationError):
        MemoDraft(headline="h" * 91, why="w", watch_out="w", recheck_when="r")


def test_unit_cost_clamped_below_price():
    p = BusinessProfile(**{**_profile(), "price": 10.0, "unit_cost": 12.0})
    assert p.unit_cost < p.price
    assert p.unit_cost == pytest.approx(9.5)
    ok = BusinessProfile(**_profile())
    assert ok.unit_cost == _profile()["unit_cost"]


def test_plan_to_engine_keys():
    d = _plan().to_engine()
    assert isinstance(d, dict) and set(d) == PLAN_FIELDS


def test_analyst_step_roundtrip():
    step = AnalystStep(thought="Try stock first", action="test", plans=[_plan()], pick="Stock up 4 wk", why="Safest")
    assert AnalystStep.model_validate_json(step.model_dump_json()) == step
    AnalystStep(thought="done", action="finish", plans=[], pick="Do nothing", why="Nothing beats it")


def _tokens(messages) -> float:
    return sum(len(m["content"]) for m in messages) / 4


TABLE = (
    "plan | mild | news | severe | shipping\n"
    "Raise price 5% now | +1.2/-0.4/62% | +2.0/-0.9/58% | +3.1/-2.2/51% | +0.8/-0.3/60%\n"
    "Stock up 4 weeks now | +0.9/+0.1/70% | +2.4/+0.3/66% | +4.0/+0.2/64% | +1.5/+0.4/71%"
)
NEWS = [
    {"title": "Robusta hits record", "source": "reuters.com", "quote": "Robusta futures rose 31% in a month."},
    {"title": "Highlands drought", "source": "ft.com", "quote": "Dry weather cuts the harvest."},
]


def test_profile_parser_prompt():
    for ex in EXAMPLES.values():
        m = prompts.profile_parser_messages(ex["text"])
        assert [x["role"] for x in m] == ["system", "user"]
        sys_text = m[0]["content"]
        for key in ("guessed_fields", "search_terms", "25,000 VND", "1.08", "unit_cost", "lead_time_weeks"):
            assert key in sys_text
        assert ex["text"].strip() in m[1]["content"]
        assert _tokens(m) < 3000


def test_analyst_prompt():
    m = prompts.analyst_messages(_profile(), NEWS, TABLE, "Cafés dislike a price rise", 2, 3, ["Do nothing", "Stock up 4 weeks now"])
    sys_text, user = m[0]["content"], m[1]["content"]
    assert _tokens(m) < 3000
    for key in ("thought", "action", "plans", "pick", "why", "SHORT", "NEW"):
        assert key in sys_text
    assert "Round 2 of 3" in user and "Stock up 4 weeks now" in user and "Robusta hits record" in user
    assert TABLE in user


def test_memo_prompt():
    numbers = {"shock_id": "news", "mean_delta_usd": 4200, "p5_delta_usd": -900, "p_better": 0.66, "n": 1000}
    m = prompts.memo_messages(_profile(), "Stock up 4 weeks now", _plan().to_engine(), numbers, NEWS)
    assert _tokens(m) < 3000
    for key in ("headline", "why", "watch_out", "recheck_when", "the figures above"):
        assert key in m[0]["content"]
    assert "4200" in m[1]["content"] and "Stock up 4 weeks now" in m[1]["content"]


def test_plan_crowd_prompt():
    plan = _plan(price_change_pct=5)
    m = prompts.plan_crowd_messages(ARCH[:6], _profile(), plan.to_engine(), 10.5, batch=0)
    user = m[1]["content"]
    assert _tokens(m) < 3000
    for key in ("archetypes", "bubble", "mu_a", "sigma_b"):
        assert key in m[0]["content"]
    assert "independent cafés" in user and "10.5" in user and "11.55" in user
    for a in ARCH[:6]:
        assert f'id={a["id"]}' in user


@pytest.mark.parametrize("ex_id", sorted(EXAMPLES))
def test_example_files(ex_id):
    ex = EXAMPLES[ex_id]
    assert ex["id"] == ex_id
    assert set(ex) == {"id", "title", "subtitle", "text", "scenario_id", "seed_queries", "fallback_shock", "profile"}
    assert (ROOT / "fixtures" / "scenarios" / f"{ex['scenario_id']}.json").exists()
    assert ex["seed_queries"] and {"delta_c_raw", "delta_lead_time", "demand_shock"} <= set(ex["fallback_shock"])
    assert 2 <= len(re.findall(r"[.!?](?:\s|$)", ex["text"])) <= 4
    p = BusinessProfile(**ex["profile"])
    assert p.unit_cost < p.price
