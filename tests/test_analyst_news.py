"""P3 tests: analyst loop, shopper reactions, news watch. Router and Tavily are fakes; no network."""
import asyncio
import json
import re
from pathlib import Path
from types import SimpleNamespace as NS

import pytest

from backend.agents import prompts, wording
from backend.agents.analyst import Analyst, build_columns
from backend.agents.schemas import (
    AnalystStep,
    ArchetypeSentiment,
    CrowdBatch,
    Evidence,
    MemoDraft,
    ScenarioSet,
    ShockVector,
    crowd_to_sentiment,
)
from backend.engine import planner
from backend.engine.planner import PlanSpec, ShockCase
from backend.services.news_watch import NewsWatch, exact_span
from backend.services.tavily_scout import TavilyScout

ROOT = Path(__file__).resolve().parent.parent
EXAMPLES = {p.stem: json.loads(p.read_text()) for p in sorted((ROOT / "fixtures" / "examples").glob("*.json"))}
PROFILE = EXAMPLES["coffee_hcmc"]["profile"]
N_PATHS = 200

NEWS_KNOBS = {"delta_c_raw": 0.31, "delta_lead_time": 1, "demand_shock": -0.05}
NEWS = {
    "items": [
        {"id": "n1", "kind": "supply", "title": "Robusta hits record", "url": "https://reuters.com/a1", "source": "reuters.com",
         "published": "2026-10-14", "quote": "Robusta futures rose 31% in a month.", "shock": NEWS_KNOBS,
         "cost_line": "x", "impact_usd": -5000.0, "impact_p5_usd": -7000.0, "live": False, "applied": True},
        {"id": "m1", "kind": "market", "title": "New chain opens in District 1", "url": "https://vnexpress.net/m1", "source": "vnexpress.net",
         "published": "2026-10-10", "quote": "A chain plans 40 stores.", "shock": None, "cost_line": None,
         "impact_usd": None, "impact_p5_usd": None, "live": False, "applied": False},
    ],
    "used_for_grid": "n1",
    "news_shock": NEWS_KNOBS,
}


def plan_dict(name, **kw):
    base = {"name": name, "price_change_pct": 0, "price_change_week": 0, "extra_stock_weeks": 0, "stock_week": 0,
            "marketing_change_pct": 0, "switch_supplier": False, "alt_cost_change_pct": 0, "alt_lead_time_weeks": 3,
            "alt_shock_exposure": 0.3}
    return {**base, **kw}


def case_dict(label="Beans +15%", **kw):
    base = {"label": label, "delta_c_raw": 0.15, "delta_lead_time": 0, "demand_shock": 0.0, "rival_price_change_pct": 0,
            "share_shift_pct": 0, "onset_week": 2, "ramp_weeks": 3, "likelihood": "possible", "why": "A milder year",
            "source_ids": ["n1"]}
    return {**base, **kw}


def scenario_set(*cases, unmodelled=()):
    return ScenarioSet.model_validate({"thought": "Three futures", "cases": list(cases), "unmodelled": list(unmodelled)})


GOOD_SCENARIOS = scenario_set(
    case_dict("Beans +15%"),
    case_dict("Highland cuts 5%", delta_c_raw=0.31, delta_lead_time=1, demand_shock=-0.05, rival_price_change_pct=-5,
              share_shift_pct=0, likelihood="possible", source_ids=["n1", "m1"]),
    case_dict("Beans +50%", delta_c_raw=0.5, delta_lead_time=3, likelihood="unlikely"),
    unmodelled=[{"text": "A new coffee import tax is being discussed", "source_id": "m1"},
                {"text": "Strike at the port", "source_id": "zz"}],
)


def step(action, plans=(), pick="Stock up 4 weeks now", thought="Trying something", why="Because"):
    return AnalystStep.model_validate(
        {"thought": thought, "action": action, "plans": [plan_dict(**p) if isinstance(p, dict) else p for p in plans],
         "pick": pick, "why": why}
    )


MEMO = MemoDraft(headline="Stock up now, then raise price later", why="Cheaper stock beats the extra cost",
                 watch_out="If prices fade you tie up cash", recheck_when="When the next coffee report lands")


def crowd_batch(messages, mu_a=0.2, mu_b=-0.1):
    ids = [int(i) for i in re.findall(r"^id=(\d+) ", messages[1]["content"], flags=re.MULTILINE)]
    return CrowdBatch(archetypes=[
        ArchetypeSentiment(id=i, mu_a=mu_a, mu_b=mu_b, sigma_a=0.1, sigma_b=0.1, bubble=f"Group {i} thinks it over")
        for i in ids
    ])


FAIL = object()


class FakeRouter:
    """Scripted replies per schema. A reply is a model, a callable(messages) -> model, or FAIL (parsed=None)."""

    def __init__(self, script, default_crowd=True):
        self.script = {k: list(v) for k, v in script.items()}
        self.default_crowd = default_crowd
        self.calls = []

    async def call(self, tier, messages, schema, *, thinking, role="", on_reasoning=None, **kw):
        self.calls.append((tier, schema.__name__, role, thinking))
        await asyncio.sleep(0.001)  # a little latency so concurrent calls actually interleave
        if thinking and on_reasoning:
            res = on_reasoning("thinking...")
            if asyncio.iscoroutine(res):
                await res
        queue = self.script.get(schema)
        if queue:
            item = queue.pop(0)
        elif schema is CrowdBatch and self.default_crowd:
            item = crowd_batch
        else:
            item = FAIL
        if callable(item) and item is not FAIL:
            item = item(messages)
        parsed = None if item is FAIL else item
        return NS(parsed=parsed, fallback_needed=parsed is None, record=NS(total_ms=12.0), raw_text="", reasoning_text="")


def full_script(**over):
    s = {
        ScenarioSet: [GOOD_SCENARIOS],
        AnalystStep: [
            step("test", [{"name": "Stock 3 wk + raise 3% wk 4", "extra_stock_weeks": 3, "price_change_pct": 3,
                           "price_change_week": 4}, {"name": "Switch supplier", "switch_supplier": True,
                                                     "alt_cost_change_pct": 5, "alt_lead_time_weeks": 4}],
                 pick="Stock 3 wk + raise 3% wk 4"),
            step("test", [{"name": "Stock 2 wk + marketing", "extra_stock_weeks": 2, "marketing_change_pct": 20}],
                 pick="Stock 3 wk + raise 3% wk 4", why="Stock 2 wk + marketing is cheaper but weaker"),
            step("finish", [], pick="Stock 3 wk + raise 3% wk 4", why="Good enough"),
        ],
        MemoDraft: [MEMO],
    }
    s.update(over)
    return s


class Recorder:
    def __init__(self):
        self.events = []

    def __call__(self, event, data):
        self.events.append((event, data))

    def of(self, name):
        return [d for e, d in self.events if e == name]

    def index(self, name):
        return next(i for i, (e, _) in enumerate(self.events) if e == name)


def make_analyst(router, rec, shocks=None, news=NEWS, **kw):
    return Analyst(router, planner.calibrate(PROFILE), PROFILE, news, shocks, rec, n_paths=N_PATHS, **kw)


# --- the full run ---------------------------------------------------------------------------------

CELL_KEYS = {"plan_name", "shock_id", "n", "mean_delta_usd", "p5_delta_usd", "p_better", "mean_profit_usd", "source",
             "bridge", "steady_rival_delta_usd", "peak_cash_usd", "payback_week", "over_cash"}
STEP_KEYS = {"round", "kind", "text", "plan_name", "tier", "latency_ms"}
MEMO_KEYS = {"plan_name", "headline", "why", "watch_out", "recheck_when", "numbers", "cost_line", "sources", "not_modelled",
             "fallback_used", "actions", "runner_up"}


async def test_full_run_coffee():
    rec, router = Recorder(), FakeRouter(full_script())
    analyst = make_analyst(router, rec)
    out = await analyst.run()

    names = [e for e, _ in rec.events]
    assert names[-1] == "memo"
    assert rec.index("scenarios") + 1 == rec.index("shocks") < rec.index("plan") < rec.index("crowd") < rec.index("grid_cell")
    assert rec.index("grid_cell") < rec.index("grid_summary")
    assert names.count("grid_summary") == 3  # seed + 2 test rounds; round 3 finishes
    assert names.count("memo") == 1

    kinds = [d["kind"] for d in rec.of("agent_step")]
    assert kinds.count("think") == 3 and kinds.count("finish") == 1
    assert {"test", "result", "shoppers"} <= set(kinds)
    # round 1 order: think, then test steps, then per plan shoppers + result
    r1 = [d for d in rec.of("agent_step") if d["round"] == 1]
    assert r1[0]["kind"] == "think" and r1[0]["tier"] == "ultra"
    assert [d["kind"] for d in r1].index("test") < [d["kind"] for d in r1].index("shoppers") < [d["kind"] for d in r1].index("result")
    for d in rec.of("agent_step"):
        assert set(d) == STEP_KEYS and len(d["text"]) <= 300
    assert any(re.search(r"[+−]\$[\d.]+k? on average · bad case", d["text"]) for d in rec.of("agent_step") if d["kind"] == "result")

    assert [(d["role"], d["round"]) for d in rec.of("reasoning")][:1] == [("scenarios", 0)]
    assert {d["role"] for d in rec.of("reasoning_done")} == {"scenarios", "analyst"}

    scen = rec.of("scenarios")[0]
    assert set(scen) == {"thought", "unmodelled", "fallback_used"} and scen["fallback_used"] is False
    assert scen["unmodelled"] == [
        {"text": "A new coffee import tax is being discussed", "source_id": "m1"},
        {"text": "Strike at the port", "source_id": None},
    ]
    cases = rec.of("shocks")[0]["cases"]
    assert cases[0]["id"] == "news" and cases[0]["origin"] == "news"
    assert [c["id"] for c in cases[1:]] == ["s1", "s2", "s3"] and len(cases) <= 6
    assert all("cost_line" in c and c["cost_line"] for c in cases)

    for d in rec.of("plan"):
        assert set(d) == {"name", "source", "round", "spec"}
    assert [(d["name"], d["source"]) for d in rec.of("plan")][:2] == [("Raise price 5% now", "seed"), ("Stock up 4 weeks now", "seed")]
    for d in rec.of("crowd"):
        assert set(d) == {"plan_name", "archetypes"} and len(d["archetypes"]) == 12
        assert set(d["archetypes"][0]) == {"id", "label", "mu", "sigma", "bubble"}
    for d in rec.of("grid_cell"):
        assert set(d) == CELL_KEYS and d["source"] == "local"
    for d in rec.of("grid_summary"):
        assert set(d) == {"baseline_profit_usd", "best_today", "safest", "verified"} and d["verified"] is False
    assert set(rec.of("memo")[0]) == MEMO_KEYS

    assert len(out["plans"]) <= 8 and len(out["plans"]) == 5
    assert len(out["cells"]) == 5 * 4
    assert len({(c["plan_name"], c["shock_id"]) for c in out["cells"]}) == len(out["cells"])  # nothing tested twice
    assert set(out["crowd"]) == {p["name"] for p in out["plans"]}

    # seed cells equal calling the planner directly with the same seed and the same shopper sentiment
    cal = planner.calibrate(PROFILE)
    seeds = [PlanSpec(name="Raise price 5% now", price_change_pct=5), PlanSpec(name="Stock up 4 weeks now", extra_stock_weeks=4)]
    sent = crowd_to_sentiment([crowd_batch([None, {"content": "\n".join(f"id={i} x" for i in range(1, 7))}]),
                               crowd_batch([None, {"content": "\n".join(f"id={i} x" for i in range(7, 13))}])])
    # "Stock up 4 weeks now" changes nothing shoppers can see, so it is simulated with neutral shoppers (P4)
    direct = planner.evaluate_grid(cal, seeds, [ShockCase.from_dict(c) for c in cases], {"Raise price 5% now": sent}, 24, N_PATHS, 0)
    mine = [{k: v for k, v in c.items() if k != "source"} for c in out["cells"] if c["plan_name"] in {s.name for s in seeds}]
    assert mine == direct["cells"]


async def test_memo_has_bridge_not_modelled_and_actions():
    rec = Recorder()
    out = await make_analyst(FakeRouter(full_script()), rec).run()
    memo = out["memo"]
    assert memo["plan_name"] == "Stock 3 wk + raise 3% wk 4" and memo["headline"] == MEMO.headline
    n = memo["numbers"]
    assert n["shock_id"] == "news" and n["verified"] is False and n["cash_available"] == PROFILE["cash_available"]
    assert abs(sum(n["bridge"].values()) - n["mean_delta_usd"]) < 1.0 + 0.01 * 5  # the five lines sum to the mean (rounding of 5 lines)
    for k in ("steady_rival_delta_usd", "peak_cash_usd", "payback_week", "over_cash"):
        assert k in n
    assert memo["not_modelled"]["fixed"] == wording.NOT_MODELLED_FIXED and len(wording.NOT_MODELLED_FIXED) == 7
    assert memo["not_modelled"]["found"][1]["source_id"] is None
    assert memo["cost_line"].startswith("Beans +31% × 85% of your cost is beans")
    assert memo["sources"][0]["url"] == "https://reuters.com/a1"
    assert {"week", "text"} == set(memo["actions"][0]) and memo["actions"][0]["week"] == 0
    assert "Order 3 extra weeks of beans" in memo["actions"][0]["text"]
    ru = memo["runner_up"]
    assert ru["name"] != memo["plan_name"] and {"name", "mean_delta_usd", "p5_delta_usd", "why_not"} <= set(ru)
    assert "Stock 2 wk + marketing" in {p["name"] for p in out["plans"]}


async def test_ultra_pick_not_tested_uses_best_today():
    script = full_script()
    script[AnalystStep] = [step("finish", [], pick="A plan nobody tested")]
    rec = Recorder()
    out = await make_analyst(FakeRouter(script), rec).run()
    assert out["memo"]["plan_name"] == out["summary"]["best_today"]


async def test_duplicate_plan_name_is_renamed_never_retested():
    script = full_script()
    script[AnalystStep] = [
        step("test", [
            {"name": "Raise price 5% now", "price_change_pct": 3},            # name clash, different settings: renamed
            {"name": "Same as the seed", "price_change_pct": 5},               # same settings as a seed plan: skipped
            {"name": "raise price 5% now", "price_change_pct": -3},            # clash again, case-insensitive
        ], pick="Raise price 5% now"),
        step("finish", []),
    ]
    rec = Recorder()
    out = await make_analyst(FakeRouter(script), rec).run()
    names = [p["name"] for p in out["plans"]]
    assert names == ["Raise price 5% now", "Stock up 4 weeks now", "Raise price 5% now (2)", "raise price 5% now (3)"]
    assert len({n.lower() for n in names}) == len(names)
    assert len({(c["plan_name"], c["shock_id"]) for c in out["cells"]}) == len(out["cells"]) == 4 * 4
    assert "Same as the seed" not in {d["name"] for d in rec.of("plan")}


async def test_plan_limits_clamp_and_max_plans():
    script = full_script()
    script[AnalystStep] = [
        step("test", [{"name": "Too wild", "price_change_pct": 20, "extra_stock_weeks": 8, "stock_week": 23}]),
        step("test", [{"name": "p3", "price_change_pct": 1}, {"name": "p4", "price_change_pct": 2}, {"name": "p5", "price_change_pct": 4}]),
        step("test", [{"name": "p6", "price_change_pct": 6}]),
    ]
    rec = Recorder()
    out = await make_analyst(FakeRouter(script), rec, max_plans=5).run()
    assert len(out["plans"]) == 5
    assert [d["round"] for d in rec.of("plan")].count(0) == 2


async def test_ultra_fails_twice_deterministic_fallback_and_template_memo():
    router = FakeRouter({ScenarioSet: [FAIL, FAIL], AnalystStep: [FAIL, FAIL], MemoDraft: [MEMO]})
    rec = Recorder()
    out = await make_analyst(router, rec).run()
    assert [t for t in router.calls if t[1] == "AnalystStep"].__len__() == 2          # twice, then the fixed search
    assert not any(t[1] == "MemoDraft" for t in router.calls)                         # memo comes from the template
    fb = [d for d in rec.of("agent_step") if d["kind"] == "fallback"]
    assert len(fb) >= 2
    assert rec.of("scenarios")[0]["fallback_used"] is True
    cases = rec.of("shocks")[0]["cases"]
    assert [c["id"] for c in cases] == ["news", "mild", "severe", "shipping"] and cases[1]["origin"] == "default"
    searched = [p for p in out["plans"] if p["name"].startswith("Search:")]
    assert len(searched) == 2 and len(out["plans"]) == 4
    memo = out["memo"]
    assert memo["fallback_used"] is True and memo["headline"].startswith(("Go with", "Hold steady"))
    assert memo["plan_name"] == out["summary"]["best_today"]


async def test_ultra_fails_once_then_succeeds():
    script = full_script()
    script[AnalystStep] = [FAIL, step("finish", [])]
    out = await make_analyst(FakeRouter(script), Recorder()).run()
    assert out["memo"]["fallback_used"] is False and len(out["plans"]) == 2


async def test_crowd_failure_is_neutral_and_run_completes():
    script = full_script()
    router = FakeRouter(script, default_crowd=False)
    rec = Recorder()
    out = await make_analyst(router, rec).run()
    assert out["memo"]["fallback_used"] is True
    assert any(d["kind"] == "fallback" and "neutral" in d["text"] for d in rec.of("agent_step"))
    assert not any(d["kind"] == "shoppers" and d["tier"] == "fast" for d in rec.of("agent_step"))
    for d in rec.of("crowd"):
        assert all(a["mu"] == [0.0, 0.0] and a["sigma"] == [0.1, 0.1] and a["bubble"] == "" for a in d["archetypes"])
    cal = planner.calibrate(PROFILE)
    cases = [ShockCase.from_dict(c) for c in rec.of("shocks")[0]["cases"]]
    direct = planner.evaluate_grid(cal, [PlanSpec(name="Raise price 5% now", price_change_pct=5)], cases, None, 24, N_PATHS, 0)
    mine = [{k: v for k, v in c.items() if k != "source"} for c in out["cells"] if c["plan_name"] == "Raise price 5% now"]
    assert mine == direct["cells"]
    assert len(out["plans"]) == 5


async def test_one_crowd_half_fails_counts_as_neutral_for_the_rest():
    def flaky(messages):  # the second half fails every time, including the longer retry
        return FAIL if "(batch 1)" in messages[1]["content"].split("\n")[0] else crowd_batch(messages)

    script = full_script()
    script[CrowdBatch] = [flaky] * 20
    rec = Recorder()
    await make_analyst(FakeRouter(script), rec).run()
    row = rec.of("crowd")[0]["archetypes"]
    assert sum(1 for a in row if a["bubble"]) == 6
    assert any(d["kind"] == "fallback" for d in rec.of("agent_step"))


async def test_given_columns_skip_the_futures_step():
    rec = Recorder()
    shocks = [ShockCase(id="news", label="Beans +31% (today's news)", **NEWS_KNOBS, origin="news"),
              ShockCase(id="mild", label="Beans +15%", delta_c_raw=0.15, origin="default")]
    router = FakeRouter({AnalystStep: [step("finish", [])], MemoDraft: [MEMO]})
    await make_analyst(router, rec, shocks=shocks).run()
    assert "scenarios" not in [e for e, _ in rec.events]
    assert not any(t[1] == "ScenarioSet" for t in router.calls)


# --- step 0b rules --------------------------------------------------------------------------------

NEWS_CASE = ShockCase(id="news", label="Beans +31% (today's news)", **NEWS_KNOBS, origin="news", source_ids=["n1"])
IDS = {"n1", "m1"}


def columns(*cases, news=NEWS_CASE):
    return build_columns(scenario_set(*cases), news, PROFILE, IDS)


def test_rules_drop_zero_and_near_duplicates():
    cols, notes, fell = columns(
        case_dict("Mild", delta_c_raw=0.15),
        case_dict("Same as news", delta_c_raw=0.32, delta_lead_time=2, demand_shock=-0.04),   # within 2 points of news
        case_dict("Nothing", delta_c_raw=0, delta_lead_time=0, demand_shock=0),
        case_dict("Mild again", delta_c_raw=0.16),                                           # within 2 points of Mild
        case_dict("Worse", delta_c_raw=0.5),
    )
    assert not fell
    assert [c.label for c in cols] == ["Beans +31% (today's news)", "Mild", "Worse"]
    assert [c.id for c in cols] == ["news", "s1", "s2"] and all(c.origin == "ai" for c in cols[1:])
    assert any("nothing changes" in n for n in notes) and any("too close" in n for n in notes)


def test_rules_unknown_source_ids_dropped():
    cols, notes, _ = columns(case_dict("A", source_ids=["n1", "zz", "n9"]), case_dict("B", delta_c_raw=0.5, source_ids=["m7"]))
    assert cols[1].source_ids == ["n1"] and cols[2].source_ids == []
    assert any("not real news items" in n for n in notes)


def test_rules_too_few_cases_fall_back_to_default_columns():
    cols, notes, fell = columns(case_dict("Nothing", delta_c_raw=0), case_dict("Mild", delta_c_raw=0.15))
    assert fell
    assert [c.id for c in cols] == ["news", "mild", "severe", "shipping"]
    assert cols[0].origin == "news" and all(c.origin == "default" for c in cols[1:])
    assert any("Fewer than 2" in n for n in notes)


def test_rules_fraction_rival_and_share_scaled():
    cols, notes, _ = columns(
        case_dict("Highland cuts", delta_c_raw=0.15, rival_price_change_pct=-0.05, source_ids=["n1", "m1"]),
        case_dict("Chain opens", delta_c_raw=0.5, share_shift_pct=0.1, source_ids=["m1"]),
    )
    assert cols[1].rival_price_change_pct == pytest.approx(-5.0) and cols[2].share_shift_pct == pytest.approx(10.0)
    assert any("fraction" in n for n in notes)
    # whole percent points, and exactly 1, are left alone
    cols, notes, _ = columns(case_dict("A", rival_price_change_pct=-5), case_dict("B", delta_c_raw=0.5, share_shift_pct=1))
    assert cols[1].rival_price_change_pct == -5.0 and cols[2].share_shift_pct == 1.0
    assert not any("fraction" in n for n in notes)


def test_rules_insert_mild_when_nothing_is_milder_than_the_headline():
    cols, notes, _ = columns(case_dict("Worse", delta_c_raw=0.5), case_dict("Much worse", delta_c_raw=0.7))
    assert cols[1].id == "mild" and cols[1].origin == "default" and cols[1].delta_c_raw == pytest.approx(0.155)
    assert [c.id for c in cols[2:]] == ["s1", "s2"]
    assert any("milder" in n for n in notes)
    # a milder case from Ultra: nothing is inserted
    cols, notes, _ = columns(case_dict("Mild", delta_c_raw=0.15), case_dict("Worse", delta_c_raw=0.5))
    assert [c.id for c in cols] == ["news", "s1", "s2"] and not any("milder" in n for n in notes)


def test_rules_mild_insertion_keeps_at_most_five_futures():
    cols, _, _ = columns(*[case_dict(f"W{i}", delta_c_raw=0.4 + 0.1 * i) for i in range(5)])
    assert len(cols) == 6 and cols[1].id == "mild" and cols[-1].id == "s4"


def test_rules_market_ids_dropped_from_cost_only_cases_which_are_kept():
    cols, notes, _ = columns(
        case_dict("Cost only", delta_c_raw=0.15, source_ids=["n1", "m1"]),
        case_dict("Chain opens", delta_c_raw=0.5, share_shift_pct=10, source_ids=["m1"]),
    )
    assert cols[1].source_ids == ["n1"]       # market source removed, case kept
    assert cols[2].source_ids == ["m1"]       # a share-shift case may cite market news
    assert any("cost-only" in n for n in notes)


async def test_scenarios_step_emits_notes_only_when_something_changed():
    rec = Recorder()
    clean = scenario_set(case_dict("Mild", delta_c_raw=0.15), case_dict("Worse", delta_c_raw=0.5))
    await make_analyst(FakeRouter({ScenarioSet: [clean]}), rec).scenarios()
    assert not [d for d in rec.of("agent_step") if d["kind"] == "fallback"]
    assert [e for e, _ in rec.events if e in ("scenarios", "shocks")] == ["scenarios", "shocks"]

    rec = Recorder()
    messy = scenario_set(case_dict("Nothing", delta_c_raw=0), case_dict("Mild", delta_c_raw=0.15, source_ids=["zz"]),
                         case_dict("Worse", delta_c_raw=0.5))
    a = make_analyst(FakeRouter({ScenarioSet: [messy]}), rec)
    await a.scenarios()
    notes = [d["text"] for d in rec.of("agent_step") if d["kind"] == "fallback"]
    assert len(notes) == 2 and not a.fallback_used   # corrections, not a fallback
    assert len(a.shocks) == 3


# --- wording, prompts -----------------------------------------------------------------------------


def test_usd_k_rules():
    assert wording.usd_k(5000) == "+$5.0k" and wording.usd_k(-1800) == "−1.8k".replace("−1", "−$1")
    assert wording.usd_k(-114000) == "−$114k" and wording.usd_k(850) == "+$850" and wording.usd_k(1_200_000) == "+$1.2M"
    assert wording.usd_k(0) == "$0" and "-" not in wording.usd_k(-3000)


def test_result_line_and_table():
    cell = {"mean_delta_usd": 5000, "p5_delta_usd": 1200}
    assert wording.result_line(cell) == "+$5.0k on average · bad case +$1.2k"
    shocks = [{"id": "news", "label": "Beans +31%"}, {"id": "s1", "label": "Mild"}]
    cells = [
        {"plan_name": "A", "shock_id": "news", "mean_delta_usd": 5000, "p5_delta_usd": -1200, "p_better": 0.71,
         "steady_rival_delta_usd": 4100, "peak_cash_usd": 9000, "over_cash": True,
         "bridge": {"cost_usd": 100, "price_usd": 0, "volume_usd": -2000, "marketing_usd": 0, "holding_usd": -50}},
        {"plan_name": "A", "shock_id": "s1", "mean_delta_usd": 1000, "p5_delta_usd": 200, "p_better": 0.6,
         "steady_rival_delta_usd": 900, "peak_cash_usd": 0, "over_cash": False, "bridge": {}},
    ]
    table = wording.results_table(cells, shocks)
    assert "+5.0 / −1.2 / 71% · steady +4.1 · cash 9.0 OVER CASH" in table
    assert "+1.0 / +0.2 / 60%" in table.split("\n")[1] and "steady" not in table.split("\n")[1].split("|")[2]
    assert "weak spot, A: worst bad case in news (−1.2)" in table and "customers won/lost −2.0" in table


@pytest.mark.parametrize("ex_id", sorted(EXAMPLES))
@pytest.mark.parametrize("dc", [0.31, -0.2, 0.0])
def test_cost_line_matches_planner_cost_change(ex_id, dc):
    prof = EXAMPLES[ex_id]["profile"]
    line = wording.cost_line(prof, {"delta_c_raw": dc})
    ch = planner.cost_change(prof, {"delta_c_raw": dc})
    m = re.search(r"= your cost ([+−]?\d+)% \(([+−]?)\$(\d+\.\d\d) a ", line)
    assert m, line
    assert int(m.group(1).replace("−", "-")) == round(ch["pct"])
    assert float(m.group(3)) == pytest.approx(abs(ch["usd_per_unit"]), abs=0.006)
    assert f"{round(100 * prof['exposed_cost_share'])}% of your cost is" in line


def test_cost_line_coffee_example():
    assert wording.cost_line(PROFILE, {"delta_c_raw": 0.31}) == "Beans +31% × 85% of your cost is beans = your cost +26% (+$1.71 a bag)"
    assert wording.cost_line(PROFILE, {"delta_c_raw": -0.2}).startswith("Beans −20% × 85% of your cost is beans = your cost −17% (−$")


def test_bridge_lines_and_futures_block():
    lines = wording.bridge_lines({"cost_usd": 2100, "price_usd": 1500, "volume_usd": -700, "marketing_usd": 0, "holding_usd": -200})
    assert [r["label"] for r in lines] == ["Cheaper stock", "Your price change", "Customers won/lost", "Marketing",
                                           "Storage & money tied up", "Total"]
    assert lines[-1]["usd"] == 2700 and lines[-1]["text"] == "Total: +$2.7k"
    block = wording.futures_block([c.to_dict() for c in (NEWS_CASE, ShockCase(id="s1", label="Highland cuts 5%", rival_price_change_pct=-5, likelihood="possible", why="Bigger rival"))])
    assert 'news "Beans +31%' in block and "rival price −5%" in block and "Bigger rival" in block


def test_plan_actions_week_by_week():
    spec = PlanSpec(name="x", extra_stock_weeks=4, price_change_pct=10, price_change_week=5)
    acts = wording.plan_actions(spec, PROFILE, {"payback_week": 9})
    assert acts[0] == {"week": 0, "text": "Order 4 extra weeks of beans (about $7.3k)"}
    assert {"week": 5, "text": "Raise price 10% ($11.00 → $12.10)"} in acts
    assert [a["week"] for a in acts] == sorted(a["week"] for a in acts)
    assert wording.plan_actions(PlanSpec(), PROFILE) == [{"week": 0, "text": "Change nothing"}]


def test_prompts_carry_review_additions():
    sys = prompts._ANALYST_SYSTEM
    for needle in ("Staged timing", "stock_week 0", "Partial hedge within cash", "Fix the weak spot", "suggestions, not rules",
                   "steady", "OVER CASH", "bad case"):
        assert needle in sys
    assert "Try a different idea each time" not in sys
    sc = prompts._SCENARIO_SYSTEM
    for needle in ("cost up AND demand down", "rival_price_change_pct -5 to -10", "delta_lead_time +3 to +6", "false alarm"):
        assert needle in sc
    msgs = prompts.scenario_messages(PROFILE, NEWS_CASE.to_dict(), wording.cost_line(PROFILE, NEWS_CASE),
                                     NEWS["items"][:1], NEWS["items"][1:])
    assert "input price +31% (use this for delta_c_raw); your cost +26% after the 85% share (do not use this)" in msgs[1]["content"]
    assert sum(len(m["content"]) for m in prompts.analyst_messages(PROFILE, NEWS["items"][:1], "t", "", 1, 3, [])) / 4 < 3000


# --- news watch -----------------------------------------------------------------------------------

ARTICLE = ("Robusta futures rose 31% in a month as Vietnam's harvest fell short, traders said on Tuesday. "
           "Exporters expect prices to stay high through the year. Roasters in Ho Chi Minh City are raising contracts.")
SNIPPET = "Robusta futures rose 31% in a month as Vietnam's harvest fell short, traders said on Tuesday. " * 2


class FakeClient:
    def __init__(self, supply=None, market=None):
        self.searches, self.extracts = [], []
        self.supply = supply if supply is not None else [
            {"url": "https://reuters.com/world/robusta-record", "title": "Robusta hits record", "content": SNIPPET, "score": 0.9,
             "published_date": "Wed, 14 Oct 2026 08:00:00 GMT"},
            {"url": "https://reuters.com/sitemap/2026-10/08/1", "title": "Sitemap", "content": SNIPPET, "score": 0.95},
            {"url": "https://bloomberg.com/markets/data/coffee", "title": "Ticker", "content": SNIPPET, "score": 0.8},
            {"url": "https://ft.com/short-snippet", "title": "Short", "content": "tiny", "score": 0.7},
            {"url": "https://ft.com/content/coffee-harvest", "title": "Harvest falls", "content": SNIPPET, "score": 0.5},
        ]
        self.market = market if market is not None else [
            {"url": "https://vnexpress.net/chain-opens", "title": "Chuỗi mới khai trương", "content": "Một chuỗi cà phê mới " * 20,
             "score": 0.6, "published_date": "Sat, 10 Oct 2026 03:00:00 GMT"},
        ]

    async def search(self, **kw):
        self.searches.append(kw)
        return {"results": list(self.market if kw.get("topic") == "general" else self.supply)}

    async def extract(self, **kw):
        self.extracts.append(kw)
        return {"results": [{"url": u, "raw_content": ARTICLE} for u in kw["urls"]]}


class ShockRouter:
    def __init__(self, quote="robusta futures rose 31% in a month", fail=False, shock=(0.31, 1, -0.05)):
        self.quote, self.fail, self.shock, self.calls = quote, fail, shock, []

    async def call(self, tier, messages, schema, **kw):
        self.calls.append((tier, schema, kw.get("role")))
        if self.fail:
            return NS(parsed=None, fallback_needed=True)
        dc, lead, dem = self.shock
        sv = ShockVector(delta_c_raw=dc, delta_lead_time=lead, demand_shock=dem, severity=0.6,
                         evidence=[Evidence(quote=self.quote, url="https://reuters.com/world/robusta-record")])
        return NS(parsed=sv, fallback_needed=False)


def watcher(tmp_path, client=None, router=None, **kw):
    client = client or FakeClient()
    scout = TavilyScout(tmp_path, client=client, **kw)
    return NewsWatch(scout, router or ShockRouter()), client, scout


PROFILE3 = {**PROFILE, "search_terms": ["robusta price vietnam", "coffee futures record", "vietnam coffee exports"],
            "market_terms": ["chuỗi cà phê mới TP.HCM", "giá cà phê TP.HCM"]}
FALLBACK = EXAMPLES["coffee_hcmc"]["fallback_shock"]


async def test_find_filters_non_articles_before_extract(tmp_path):
    nw, client, _ = watcher(tmp_path)
    res = await nw.find(PROFILE, fallback_shock=FALLBACK, live=True)
    assert len(client.extracts) == 1
    urls = client.extracts[0]["urls"]
    assert urls == ["https://reuters.com/world/robusta-record", "https://ft.com/content/coffee-harvest"]
    assert res["dropped"] == 3
    supply = [i for i in res["items"] if i["kind"] == "supply"]
    assert [i["id"] for i in supply] == ["n1", "n2"]
    for i in supply:
        assert not re.search(r"sitemap|/markets/data", i["url"])


async def test_market_search_sends_country_and_general_topic(tmp_path):
    nw, client, _ = watcher(tmp_path)
    await nw.find(PROFILE, fallback_shock=FALLBACK, live=True)
    market = [kw for kw in client.searches if kw["topic"] == "general"]
    supply = [kw for kw in client.searches if kw["topic"] == "news"]
    assert market and all(kw["country"] == "vietnam" and kw["time_range"] == "month" and kw["search_depth"] == "basic" for kw in market)
    assert supply and all("country" not in kw and kw["time_range"] == "week" and kw["search_depth"] == "basic" for kw in supply)


async def test_market_search_without_country_skips_the_boost(tmp_path):
    nw, client, _ = watcher(tmp_path)
    await nw.find({**PROFILE, "country": ""}, fallback_shock=FALLBACK, live=True)
    market = [kw for kw in client.searches if kw["topic"] == "general"]
    assert market and all("country" not in kw for kw in market)


async def test_market_items_shape(tmp_path):
    nw, _, _ = watcher(tmp_path)
    res = await nw.find(PROFILE, fallback_shock=FALLBACK, live=True)
    m = [i for i in res["items"] if i["kind"] == "market"]
    assert [i["id"] for i in m] == ["m1"]
    i = m[0]
    assert i["shock"] is None and i["cost_line"] is None and i["impact_usd"] is None and i["impact_p5_usd"] is None
    assert 0 < len(i["quote"]) <= 200 and i["published"] == "2026-10-10" and i["source"] == "vnexpress.net"
    assert i["live"] is False and i["applied"] is False


async def test_credits_stay_within_five(tmp_path):
    nw, client, scout = watcher(tmp_path)
    res = await nw.find(PROFILE3, fallback_shock=FALLBACK, live=True)
    assert res["credits"] == scout.credits_used <= 5
    assert len(client.searches) + len(client.extracts) * 1 == 5       # 2 supply + 2 market searches + 1 extract
    assert len(client.searches) == 4


async def test_supply_item_is_grounded_and_scored(tmp_path):
    nw, _, _ = watcher(tmp_path)
    res = await nw.find(PROFILE, fallback_shock=FALLBACK, live=True)
    item = res["items"][0]
    assert set(item) == {"id", "kind", "title", "url", "source", "published", "quote", "shock", "cost_line", "impact_usd",
                         "impact_p5_usd", "live", "applied"}
    assert item["quote"] in ARTICLE and item["quote"] == "Robusta futures rose 31% in a month"   # the article's own casing
    assert item["shock"] == {"delta_c_raw": 0.31, "delta_lead_time": 1, "demand_shock": -0.05}
    assert item["cost_line"] == "Beans +31% × 85% of your cost is beans = your cost +26% (+$1.71 a bag)"
    assert item["impact_usd"] < 0 and item["impact_p5_usd"] <= item["impact_usd"]
    assert item["published"] == "2026-10-14" and item["source"] == "reuters.com"
    assert res["used_for_grid"] == "n1" and item["applied"] is True and item["live"] is False
    assert res["news_shock"] == item["shock"]


async def test_news_case_uses_largest_absolute_impact(tmp_path):
    class Alternating(ShockRouter):
        n = 0

        async def call(self, tier, messages, schema, **kw):
            Alternating.n += 1
            self.shock = (0.1, 0, 0.0) if Alternating.n == 1 else (0.6, 2, -0.1)
            return await super().call(tier, messages, schema, **kw)

    nw, _, _ = watcher(tmp_path, router=Alternating())
    res = await nw.find(PROFILE, fallback_shock=FALLBACK, live=True)
    supply = [i for i in res["items"] if i["kind"] == "supply"]
    assert len(supply) == 2 and res["used_for_grid"] == "n2"
    assert abs(supply[1]["impact_usd"]) > abs(supply[0]["impact_usd"])
    assert [i["applied"] for i in supply] == [False, True]
    assert res["news_shock"]["delta_c_raw"] == 0.6


async def test_fabricated_quote_falls_back_to_assumption(tmp_path):
    nw, _, _ = watcher(tmp_path, router=ShockRouter(quote="Coffee prices tripled overnight, officials said."))
    res = await nw.find(PROFILE, fallback_shock=FALLBACK, live=True)
    sup = [i for i in res["items"] if i["kind"] == "supply"]
    assert len(sup) == 1 and sup[0]["source"] == "Example assumption" and sup[0]["url"] == ""
    assert res["used_for_grid"] == "n1" and res["news_shock"]["delta_c_raw"] == 0.35
    assert sup[0]["quote"] == FALLBACK["evidence"][0]["quote"] and sup[0]["applied"] is True


async def test_offline_uses_the_fallback_item(tmp_path):
    nw, client, _ = watcher(tmp_path, offline=True)
    res = await nw.find(PROFILE, fallback_shock=FALLBACK, live=True)
    assert client.searches == [] and res["credits"] == 0
    assert [i["kind"] for i in res["items"]] == ["supply"]
    assert res["items"][0]["title"].startswith("Example assumption")
    assert res["news_shock"] == {"delta_c_raw": 0.35, "delta_lead_time": 1, "demand_shock": -0.1}


async def test_replay_mode_reads_cache_only(tmp_path):
    nw, client, _ = watcher(tmp_path)
    res = await nw.find(PROFILE, fallback_shock=FALLBACK, live=False)       # empty cache, live=False: no network
    assert client.searches == [] and res["items"][0]["source"] == "Example assumption"
    await nw.find(PROFILE, fallback_shock=FALLBACK, live=True)             # fills the cache
    n = len(client.searches)
    res = await nw.find(PROFILE, fallback_shock=FALLBACK, live=False)
    assert len(client.searches) == n and res["items"][0]["source"] == "reuters.com"


async def test_super_failure_falls_back(tmp_path):
    nw, _, _ = watcher(tmp_path, router=ShockRouter(fail=True))
    res = await nw.find(PROFILE, fallback_shock=FALLBACK, live=True)
    assert res["items"][0]["source"] == "Example assumption"


async def test_check_is_one_fresh_live_card(tmp_path):
    nw, client, _ = watcher(tmp_path)
    await nw.find(PROFILE, fallback_shock=FALLBACK, live=True)             # warm cache
    n_search, n_extract = len(client.searches), len(client.extracts)
    out = await nw.check(PROFILE)
    assert len(client.searches) == n_search + 1 and len(client.extracts) == n_extract + 1   # cache bypassed
    assert out["credits"] == 2 and len(out["items"]) == 1
    item = out["items"][0]
    assert item["live"] is True and item["applied"] is False and item["kind"] == "supply" and item["quote"] in ARTICLE
    assert item["id"].startswith("live")
    out2 = await nw.check(PROFILE)
    assert out2["items"][0]["id"] != item["id"]


async def test_check_offline_and_empty(tmp_path):
    nw, _, _ = watcher(tmp_path / "a", offline=True)
    assert (await nw.check(PROFILE))["items"] == []
    nw, _, _ = watcher(tmp_path / "b", client=FakeClient(supply=[]))
    out = await nw.check(PROFILE)
    assert out["items"] == [] and out["credits"] == 1


def test_exact_span_matches_the_articles_own_words():
    assert exact_span("robusta   futures ROSE 31%", ARTICLE) == "Robusta futures rose 31%"
    assert exact_span("nothing like this", ARTICLE) is None


def test_non_article_pattern():
    from backend.services.news_watch import NON_ARTICLE

    for bad in ("https://a.com/sitemap/1", "https://a.com/tag/coffee", "https://a.com/tags/x", "https://a.com/news/page/25",
                "https://a.com/index.html", "https://a.com/index", "https://a.com/quote/KC", "https://a.com/ticker/KC",
                "https://a.com/markets/data/coffee"):
        assert NON_ARTICLE.search(bad), bad
    for ok in ("https://a.com/world/robusta-record", "https://a.com/2026/10/coffee-prices-rise", "https://a.com/indexation-law"):
        assert not NON_ARTICLE.search(ok), ok


# --- fixes from the first live run (2026-10-15) ----------------------------------------------------


def test_tidy_repairs_text_cut_at_the_schema_cap():
    from backend.agents.analyst import tidy

    assert tidy("Short and fine", 300) == "Short and fine"
    cut = "First sentence is complete. Second one runs into the cap and stops mid-wo"
    assert tidy(cut, len(cut)) == "First sentence is complete."
    nosentence = "one two three four five six sev"
    assert tidy(nosentence, len(nosentence)) == "one two three four five six…"
    done = "Ends properly."
    assert tidy(done, len(done)) == done


async def test_incomplete_crowd_batch_is_asked_again_for_the_rest():
    asked = {}

    def one_group_first(messages):
        user = messages[1]["content"]
        key = user.split("\n")[0]                       # 'Plan "X" (batch N).'
        asked.setdefault(key, []).append(user)
        if len(asked[key]) == 1:
            ids = [int(i) for i in re.findall(r"^id=(\d+) ", user, flags=re.MULTILINE)]
            return crowd_batch([None, {"content": f"id={ids[0]} x"}])
        return crowd_batch(messages)

    script = full_script()
    script[CrowdBatch] = [one_group_first] * 8
    rec = Recorder()
    await make_analyst(FakeRouter(script), rec, max_rounds=0).run()
    for d in rec.of("crowd"):
        if d["plan_name"] == "Raise price 5% now":  # the stock-only seed is not shown to shoppers (P4)
            assert all(a["bubble"] for a in d["archetypes"])               # nothing left neutral
    assert not any(d["kind"] == "fallback" and "neutral" in d["text"] for d in rec.of("agent_step"))
    assert len(asked) == 2 and all(len(v) == 2 for v in asked.values())
    for _first, retry in asked.values():
        assert len(re.findall(r"^id=\d+ ", retry, flags=re.MULTILINE)) == 5      # only the 5 missing groups


async def test_zero_effect_headline_is_not_a_news_item(tmp_path):
    nw, _, _ = watcher(tmp_path, router=ShockRouter(shock=(0.0, 0, 0.0)))
    res = await nw.find(PROFILE, fallback_shock=FALLBACK, live=True)
    sup = [i for i in res["items"] if i["kind"] == "supply"]
    assert len(sup) == 1 and sup[0]["source"] == "Example assumption"


async def test_pick_made_before_the_last_tests_yields_to_a_plan_that_beats_it_everywhere():
    """Round 1 tests plan A, Ultra picks A; round 2 plans were tested after that pick. A plan that beats A on the
    average, the bad case and the worst column, within cash, takes over; otherwise A stands."""
    script = full_script()
    script[AnalystStep] = [
        step("test", [{"name": "Plan A", "extra_stock_weeks": 1}], pick="Plan A"),
        step("test", [{"name": "Plan B", "extra_stock_weeks": 3, "price_change_pct": 2, "price_change_week": 3}], pick="Plan A"),
    ]
    out = await make_analyst(FakeRouter(script), Recorder(), max_rounds=2).run()
    cells = {(c["plan_name"], c["shock_id"]): c for c in out["cells"]}
    cols = [c for c in {k[1] for k in cells}]

    def worst(name):
        return min(cells[(name, c)]["p5_delta_usd"] for c in cols)

    a = cells[("Plan A", "news")]
    dominating = [
        p["name"] for p in out["plans"]
        if p["name"] != "Plan A" and not cells[(p["name"], "news")]["over_cash"]
        and cells[(p["name"], "news")]["mean_delta_usd"] > a["mean_delta_usd"]
        and cells[(p["name"], "news")]["p5_delta_usd"] >= a["p5_delta_usd"] and worst(p["name"]) >= worst("Plan A")
    ]
    expected = max(dominating, key=lambda n: cells[(n, "news")]["mean_delta_usd"]) if dominating else "Plan A"
    assert out["memo"]["plan_name"] == expected
    assert expected != "Plan A"          # with these settings a better plan exists; the test would be vacuous otherwise


async def test_pick_stands_when_ultra_has_seen_every_result():
    script = full_script()
    script[AnalystStep] = [step("test", [{"name": "Plan A", "extra_stock_weeks": 1}], pick="Plan A"),
                           step("finish", [], pick="Plan A")]
    out = await make_analyst(FakeRouter(script), Recorder(), max_rounds=2).run()
    assert out["memo"]["plan_name"] == "Plan A"        # not the best on average, but Ultra picked it after seeing everything
