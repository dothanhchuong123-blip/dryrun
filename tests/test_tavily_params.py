"""Newer Tavily parameters (Oct 2026 changelog, tavily-python 0.8.5): what is sent, and what changes the cache key."""
import hashlib
import json

from test_tavily_scout import FakeClient, make


def old_key(req: dict) -> str:
    """How a search cache file was named before these parameters existed."""
    return hashlib.sha1(json.dumps({"kind": "search", **req}, sort_keys=True, default=str).encode()).hexdigest()


async def test_plain_search_keeps_its_old_cache_key_and_asks_for_favicon_and_usage(tmp_path):
    sc = make(tmp_path)
    await sc.search("q", "basic", "week")
    kw = sc.client.searches[0]
    assert kw["include_favicon"] is True and kw["include_usage"] is True
    assert not {"include_domains_mode", "language", "filter_by_language", "exact_match"} & set(kw)
    old = old_key({"query": "q", "depth": "basic", "time_range": "week", "include_domains": []})
    assert (tmp_path / f"search_{old}.json").exists()      # favicon and usage are not part of the key


async def test_new_params_are_sent_only_when_asked_for_and_join_the_key(tmp_path):
    sc = make(tmp_path)
    await sc.search("q", "basic", "month", topic="general", country="vietnam", language="vi", exact_match=True)
    kw = sc.client.searches[0]
    assert kw["language"] == "vi" and kw["exact_match"] is True and kw["country"] == "vietnam"
    assert "filter_by_language" not in kw                  # a boost, not a filter, unless asked
    plain = old_key({"query": "q", "depth": "basic", "time_range": "month", "include_domains": [], "topic": "general", "country": "vietnam"})
    assert not (tmp_path / f"search_{plain}.json").exists()
    await sc.search("q", "basic", "month", topic="general", country="vietnam")   # the old, plain search: its own entry
    assert (tmp_path / f"search_{plain}.json").exists() and len(sc.client.searches) == 2


async def test_domains_mode_needs_a_domain_list_and_filter_needs_a_language(tmp_path):
    sc = make(tmp_path)
    await sc.search("a", "basic", "week", include_domains_mode="prefer")
    await sc.search("b", "basic", "week", ["reuters.com"], include_domains_mode="prefer")
    await sc.search("c", "basic", "week", filter_by_language=True)
    await sc.search("d", "basic", "week", language="de", filter_by_language=True)
    a, b, c, d = sc.client.searches
    assert "include_domains_mode" not in a and b["include_domains_mode"] == "prefer" and b["include_domains"] == ["reuters.com"]
    assert "filter_by_language" not in c and "language" not in c      # Tavily would answer 400
    assert d["language"] == "de" and d["filter_by_language"] is True


async def test_exact_match_that_finds_nothing_is_retried_once_without_it(tmp_path):
    from test_analyst_news import ShockRouter

    from backend.services.news_watch import NewsWatch
    from backend.services.tavily_scout import TavilyScout

    class Strict(FakeClient):
        async def search(self, **kw):
            self.searches.append(kw)
            hit = {"url": "https://vnexpress.net/a", "title": "Highland mở cửa hàng", "content": "Highland mở thêm cửa hàng mới " * 6}
            return {"results": [] if kw.get("exact_match") else [hit]}

    client = Strict()
    nw = NewsWatch(TavilyScout(tmp_path, client=client), ShockRouter())
    got = await nw._search('"Highland Coffee" cửa hàng mới', time_range="month", topic="general", country="vietnam", live=True, kind="market")
    assert len(got) == 1 and len(client.searches) == 2
    assert client.searches[0]["exact_match"] is True and "exact_match" not in client.searches[1]
    row = nw._log[0]
    assert row["exact_match"] is False and row["exact_match_dropped"] is True and row["credits"] == 2 and row["language"] == "vi"


async def test_real_credits_from_usage_replace_the_list_price(tmp_path):
    class Usage(FakeClient):
        async def search(self, **kw):
            return {**await super().search(**kw), "usage": {"credits": 2}}

    sc = make(tmp_path)
    sc._client = Usage()
    await sc.search("q", "basic", "week")
    assert sc.credits_used == 2                            # Tavily said 2, the list price says 1
    await sc.search("q", "basic", "week")                  # cached: nothing more
    assert sc.credits_used == 2
