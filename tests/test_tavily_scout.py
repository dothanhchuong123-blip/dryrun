"""T06 tests: Tavily and the router are both mocked; no network."""
import json
from pathlib import Path
from types import SimpleNamespace as NS

import pytest

from backend.agents.schemas import Evidence, ScoutQuery, ShockVector
from backend.services.tavily_scout import DeepScout, OfflineCacheMiss, TavilyScout

ARTICLE = "Washington announced a 25% tariff on semiconductors on Monday. Freight rates rose sharply."
SCENARIO = json.loads((Path(__file__).parent.parent / "fixtures/scenarios/gpu_tariff.json").read_text())


class FakeClient:
    def __init__(self):
        self.searches, self.extracts = [], []

    async def search(self, **kw):
        self.searches.append(kw)
        return {"results": [{"url": "https://a.com/1", "title": "A"}, {"url": "https://b.com/2", "title": "B"}]}

    async def extract(self, **kw):
        self.extracts.append(kw)
        return {"results": [{"url": u, "raw_content": ARTICLE} for u in kw["urls"]]}


class FakeRouter:
    def __init__(self, shock=None, query="red sea shipping delays"):
        self.shock, self.query, self.calls = shock, query, []

    async def call(self, tier, messages, schema, **kw):
        self.calls.append((tier, schema, kw))
        parsed = self.shock if schema is ShockVector else ScoutQuery(query=self.query)
        return NS(parsed=parsed, fallback_needed=parsed is None)


def shock(*quotes):
    return ShockVector(delta_c_raw=0.25, delta_lead_time=2, demand_shock=-0.05, severity=0.6,
                       evidence=[Evidence(quote=q, url="https://a.com/1") for q in quotes])


def make(tmp_path, s=None, **kw):
    return TavilyScout(tmp_path, client=FakeClient(), router=FakeRouter(s), **kw)


async def test_cache_hit_makes_no_call(tmp_path):
    sc = make(tmp_path)
    await sc.search("q", "advanced")
    await sc.search("q", "advanced")
    assert len(sc.client.searches) == 1
    assert sc.credits_used == 2
    await sc.extract(["https://a.com/1"], "q")
    await sc.extract(["https://a.com/1"], "q")
    assert len(sc.client.extracts) == 1 and sc.credits_used == 3


async def test_credit_accounting(tmp_path):
    sc = make(tmp_path)
    await sc.search("a", "basic")
    assert sc.credits_used == 1
    await sc.extract([f"https://x.com/{i}" for i in range(6)], "a")
    assert sc.credits_used == 3  # ceil(6/5) = 2


async def test_offline_raises_on_miss_and_serves_cache(tmp_path):
    make(tmp_path).client  # noqa: B018
    online = make(tmp_path)
    await online.search("q", "basic")
    off = make(tmp_path, offline=True)
    assert (await off.search("q", "basic"))["results"]
    with pytest.raises(OfflineCacheMiss):
        await off.search("other", "basic")


async def test_fabricated_quote_dropped(tmp_path):
    sc = make(tmp_path, shock("25% tariff on semiconductors", "a 90% ban on everything, officials said"))
    shk, cards = await sc.ground_shock(SCENARIO)
    assert [e.quote for e in shk.evidence] == ["25% tariff on semiconductors"]
    assert len(cards) == 1
    c = cards[0]
    assert c["param"] == "delta_c_raw" and c["value"] == 0.25 and c["live"] is False and c["applied"] is False
    assert set(c) == {"id", "query", "url", "title", "quote", "param", "value", "ts", "live", "applied"}
    assert c["title"] == "A"
    assert sc.credits_used == 3  # advanced search 2 + extract 1


async def test_all_quotes_fabricated_uses_fallback(tmp_path):
    sc = make(tmp_path, shock("totally invented sentence here"))
    res = await sc.ground_shock(SCENARIO)
    assert res.fallback and res.shock.delta_c_raw == SCENARIO["fallback_shock"]["delta_c_raw"]


async def test_tavily_failure_uses_fallback(tmp_path):
    sc = make(tmp_path, shock("25% tariff on semiconductors"), offline=True)  # cache empty -> miss
    res = await sc.ground_shock(SCENARIO)
    assert res.fallback


async def test_news_check_bypasses_cache_and_reports_credits(tmp_path):
    sc = make(tmp_path, shock("25% tariff on semiconductors"))
    r1 = await sc.news_check(SCENARIO)
    r2 = await sc.news_check(SCENARIO)
    assert len(sc.client.searches) == 2 and len(sc.client.extracts) == 2  # no cache reads
    assert sc.client.searches[0]["search_depth"] == "basic"
    assert len(sc.client.extracts[0]["urls"]) == 1
    assert r1.credits == r2.credits == 2
    assert r1.cards[0]["live"] is True and r1.cards[0]["applied"] is False
    assert list(tmp_path.glob("search_*.json"))  # still written to cache
    shk, cards = r1  # unpacks as a pair
    assert shk is r1.shock and cards is r1.cards


async def test_news_check_offline_raises(tmp_path):
    with pytest.raises(OfflineCacheMiss):
        await make(tmp_path, offline=True).news_check(SCENARIO)


def hist(margins, leads=None, new_shock_at=None):
    leads = leads or [3] * len(margins)
    return [{"tick": i, "margin": m, "lead_time": l, "new_shock": i == new_shock_at}
            for i, (m, l) in enumerate(zip(margins, leads))]


def test_trigger_logic(tmp_path):
    d = DeepScout(make(tmp_path))
    assert d.should_trigger(hist([0.2, 0.2, 0.2])) is None  # too short
    assert d.should_trigger(hist([0.2, 0.2, 0.19, 0.2])) is None
    assert "margin" in d.should_trigger(hist([0.20, 0.19, 0.17, 0.16]))  # -20%
    assert d.should_trigger(hist([0.20, 0.19, 0.17, 0.16], new_shock_at=2)) is None  # explained
    assert d.should_trigger(hist([0.2] * 4, leads=[3, 3, 4, 5])) is not None
    assert d.should_trigger(hist([0.2] * 4, leads=[3, 3, 4, 4])) is None
    assert d.should_trigger(hist([-0.1, -0.2, -0.3, -0.4])) is None  # no positive base margin


async def test_deep_scout_one_per_epoch(tmp_path):
    sc = make(tmp_path, shock("25% tariff on semiconductors"))
    d = DeepScout(sc)
    h = hist([0.20, 0.19, 0.17, 0.16])
    res = await d.run(h, 1, SCENARIO)
    assert res and res.shock and res.credits == 2  # basic search 1 + extract 1
    assert sc.client.searches[0]["query"] == "red sea shipping delays"
    assert sc.client.searches[0]["search_depth"] == "basic"
    assert await d.run(h, 1, SCENARIO) is None
    assert await d.run(h, 2, SCENARIO) is not None
