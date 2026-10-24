"""Ultra's own web search (EVENTS v2.6, SPEC §15.6). Router, scout and Tavily are fakes; no network."""
import pytest
from test_analyst_news import (
    NEWS,
    PROFILE,
    FakeClient,
    FakeRouter,
    Recorder,
    ShockRouter,
    full_script,
    make_analyst,
    step,
    watcher,
)

from backend.agents import prompts
from backend.agents.schemas import AnalystStep
from backend.engine.planner import ShockCase

STOCK3 = {"name": "Stock 3 wk + raise 3% wk 4", "extra_stock_weeks": 3, "price_change_pct": 3, "price_change_week": 4}


def search_step(query="highland coffee price cut", why="Rival price move is missing", **kw):
    s = step("search", [], **kw)
    return s.model_copy(update={"query": query, "search_why": why})


def fake_item(item_id, **knobs):
    shock = {"delta_c_raw": 0.12, "delta_lead_time": 2, "demand_shock": 0.0, **knobs}
    return {"id": item_id, "kind": "supply", "title": "Port strike delays beans", "url": "https://nhandan.vn/port-strike",
            "source": "nhandan.vn", "published": "2026-10-20", "favicon": "", "quote": "Beans shipments were delayed two weeks",
            "shock": shock, "cost_line": "Beans +12% × 85% of your cost is beans = your cost +10%", "impact_usd": -900.0,
            "impact_p5_usd": -1500.0, "live": False, "applied": False}


class FakeSearch:
    def __init__(self, results):
        self.results, self.calls = list(results), []

    async def __call__(self, query, item_id):
        self.calls.append((query, item_id))
        r = self.results.pop(0)
        return r(item_id) if callable(r) else r


def ok_result(**knobs):
    return lambda item_id: {"ok": True, "item": fake_item(item_id, **knobs), "credits": 2, "reason": "",
                            "search": {"query": "q", "results": 5}, "extract": {"urls": 1, "read": 1}}


def search_script(*steps):
    script = full_script()
    script[AnalystStep] = [*steps, step("finish", [], pick=STOCK3["name"], why="Good enough")]
    return script


def grid(n_ai, over=None):
    cols = [ShockCase.from_dict({"id": "news", "label": "Beans +31%", "delta_c_raw": 0.31, "origin": "news", "likelihood": "likely"})]
    for i in range(1, n_ai + 1):
        cols.append(ShockCase.from_dict({
            "id": f"s{i}", "label": f"Guess {i}", "delta_c_raw": 0.05 * i + 0.4, "origin": "ai", "likelihood": "likely",
            "source_ids": ["n1"], **(over or {}).get(i, {}),
        }))
    return cols


async def test_search_action_adds_a_column_every_plan_is_tested_in():
    rec, fs = Recorder(), FakeSearch([ok_result()])
    script = search_script(step("test", [STOCK3], pick=STOCK3["name"]), search_step(pick=STOCK3["name"]))
    analyst = make_analyst(FakeRouter(script), rec, search=fs)
    out = await analyst.run()
    ev = rec.of("analyst_search")
    assert len(ev) == 1 and fs.calls == [("highland coffee price cut", "x1")]
    e = ev[0]
    assert e["status"] == "added" and e["round"] == 2 and e["replaced_id"] is None and e["credits"] == 2
    assert e["case"]["id"] == "w1" and e["case"]["origin"] == "news" and e["case"]["source_ids"] == ["x1"]
    assert e["case"]["label"].endswith("(searched)") and e["case"]["cost_line"]
    assert [c["id"] for c in rec.of("shocks")[-1]["cases"]] == ["news", "s1", "s2", "s3", "w1"]
    names = {p["name"] for p in out["plans"]}
    assert {c["plan_name"] for c in out["cells"] if c["shock_id"] == "w1"} == names   # every plan has a cell there
    assert len({(c["plan_name"], c["shock_id"]) for c in out["cells"]}) == len(out["cells"])
    steps = [d for d in rec.of("agent_step") if d["kind"] == "search"]
    assert steps[0]["text"].startswith("Nemotron asked Tavily: “highland coffee price cut”") and steps[0]["tier"] == "ultra"
    assert any(d["tier"] == "super" for d in steps)
    src = next(s for s in out["memo"]["sources"] if s["url"] == "https://nhandan.vn/port-strike")
    assert src["source"] == "nhandan.vn" and src["published"] == "2026-10-20"
    assert analyst.search_credits == 2 and analyst.searched == ["highland coffee price cut"]


async def test_search_replaces_the_weakest_guess_when_the_grid_is_full():
    rec, fs = Recorder(), FakeSearch([ok_result()])
    analyst = make_analyst(FakeRouter(search_script(search_step())), rec, shocks=grid(5, {3: {"likelihood": "unlikely"}}), search=fs)
    out = await analyst.run()
    e = rec.of("analyst_search")[0]
    assert e["status"] == "added" and e["replaced_id"] == "s3"
    now = [c["id"] for c in rec.of("shocks")[-1]["cases"]]
    assert len(now) == 6 and "s3" not in now and now[-1] == "w1"
    assert all(c["shock_id"] != "s3" for c in out["cells"])


async def test_search_is_skipped_when_nothing_can_be_replaced():
    rec, fs = Recorder(), FakeSearch([ok_result()])
    await make_analyst(FakeRouter(search_script(search_step())), rec, shocks=grid(5), search=fs).run()
    e = rec.of("analyst_search")[0]
    assert e["status"] == "skipped" and "full" in e["reason"] and fs.calls == []   # no credit spent
    assert rec.of("shocks") == [] and rec.of("memo")


@pytest.mark.parametrize("result", [
    {"ok": False, "item": None, "credits": 1, "reason": "The search found no usable article."},
    ok_result(delta_c_raw=0.31, delta_lead_time=1, demand_shock=-0.05),     # the same as the news column: a twin
])
async def test_failed_or_duplicate_search_skips_the_column_and_carries_on(result):
    rec, fs = Recorder(), FakeSearch([result])
    out = await make_analyst(FakeRouter(search_script(search_step())), rec, search=fs).run()
    e = rec.of("analyst_search")[0]
    assert e["status"] == "skipped" and e["item"] is None and e["case"] is None
    assert [c["id"] for c in rec.of("shocks")[-1]["cases"]] == ["news", "s1", "s2", "s3"]
    assert out["memo"]["plan_name"]


async def test_search_limits_and_a_crashing_scout():
    rec = Recorder()

    async def boom(query, item_id):
        raise RuntimeError("tavily down")

    script = search_script(search_step("one"), search_step("two"), search_step("three"))
    analyst = make_analyst(FakeRouter(script), rec, search=boom)
    out = await analyst.run()
    ev = rec.of("analyst_search")
    assert [e["status"] for e in ev] == ["skipped", "skipped", "skipped"] and "limit" in ev[2]["reason"]
    assert len(analyst.searched) == 2 and out["memo"]["plan_name"]          # 2 per analysis, then no more


def test_prompt_tells_ultra_how_many_searches_are_left():
    on = prompts.analyst_messages(PROFILE, NEWS["items"][:1], "t", "", 1, 3, [], searches_left=2, searched=["a"])
    assert "Web searches left: 2" in on[1]["content"] and "Already searched: a." in on[1]["content"]
    assert "Web searches left: 0" in prompts.analyst_messages(PROFILE, NEWS["items"][:1], "t", "", 1, 3, [])[1]["content"]
    assert 'action to "search"' in prompts._ANALYST_SYSTEM


async def test_no_search_callable_means_a_search_action_is_skipped():
    rec = Recorder()
    await make_analyst(FakeRouter(search_script(search_step())), rec).run()
    assert rec.of("analyst_search")[0]["status"] == "skipped"


async def test_lookup_reads_the_top_article_and_reports_the_credits(tmp_path):
    nw, client, scout = watcher(tmp_path)
    res = await nw.lookup(PROFILE, "robusta price", item_id="x1", live=True)
    assert res["ok"] and res["item"]["id"] == "x1" and res["item"]["applied"] is False
    assert res["item"]["quote"] == "Robusta futures rose 31% in a month"
    assert res["credits"] == scout.credits_used == 2 and res["search"]["credits"] == 1 and res["extract"]["credits"] == 1
    assert len(client.searches) == 1 and len(client.extracts) == 1
    assert client.extracts[0]["urls"] == ["https://reuters.com/world/robusta-record"]


async def test_lookup_failures_never_raise(tmp_path):
    nw, _, _ = watcher(tmp_path, router=ShockRouter(fail=True))
    res = await nw.lookup(PROFILE, "robusta price", item_id="x1", live=True)
    assert res["ok"] is False and res["item"] is None and "own words" in res["reason"]
    nw, _, _ = watcher(tmp_path / "b", router=ShockRouter(quote="a quote that is not on the page"))
    assert (await nw.lookup(PROFILE, "q", item_id="x1", live=True))["ok"] is False
    nw, client, _ = watcher(tmp_path / "c", client=FakeClient(supply=[]))
    res = await nw.lookup(PROFILE, "q", item_id="x1", live=True)
    assert res["ok"] is False and "no usable article" in res["reason"] and client.extracts == []
    nw, client, scout = watcher(tmp_path / "d")          # REPLAY: cache only, empty cache, no spend
    res = await nw.lookup(PROFILE, "q", item_id="x1", live=False)
    assert res["ok"] is False and scout.credits_used == 0 and client.searches == []
