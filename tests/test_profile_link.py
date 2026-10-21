"""F4 tests: paste a link on the profile parser. Fake Tavily client and scripted router; no network."""
import httpx

from backend.agents.prompts import profile_parser_messages
from backend.agents.schemas import BusinessProfile
from backend.config import Settings
from backend.main import create_app
from backend.services.tavily_scout import TavilyScout
from backend.sim.analysis import load_example
from backend.sim.offline import ScriptedRouter

PROFILE = BusinessProfile.model_validate(load_example("coffee_hcmc")["profile"])
LONG = "Cafe Sao serves slow-drip coffee in Saigon. A cup costs 45,000 VND. " * 6


class PageClient:
    def __init__(self, raw="", results=None):
        self.raw, self.results, self.searches, self.extracts = raw, results, [], []

    async def extract(self, **kw):
        self.extracts.append(kw)
        return {"results": [{"url": kw["urls"][0], "title": "Cafe Sao", "raw_content": self.raw}] if self.raw else []}

    async def search(self, **kw):
        self.searches.append(kw)
        return {"results": [{"url": "https://x.com", "title": "Cafe Sao", "content": "A cafe in Saigon."}]
                if self.results is None else self.results}


def make(tmp_path, pc, *, cap=30):
    router = ScriptedRouter({BusinessProfile: [PROFILE] * 5})
    app = create_app(
        settings=Settings(tavily_daily_credit_cap=cap, _env_file=None), router=router,
        scout_factory=lambda: TavilyScout(tmp_path / "cache", client=pc),
        telemetry_dir=tmp_path / "tel", serve_frontend=False,
    )
    return app, router


def client(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=("1.2.3.4", 1)), base_url="http://t")


async def test_url_is_read_and_counts_toward_the_cap(tmp_path):
    pc = PageClient(LONG)
    app, router = make(tmp_path, pc, cap=1)
    async with client(app) as c:
        r = await c.post("/api/profile/parse", json={"text": "", "url": "https://cafesao.vn/menu"})
        assert r.status_code == 200
        body = r.json()
        assert body["source"] == {"url": "https://cafesao.vn/menu", "title": "Cafe Sao", "method": "extract", "credits": 1}
        assert body["profile"]["business_name"] and pc.searches == []
        r = await c.post("/api/profile/parse", json={"text": "", "url": "https://other.vn"})
        assert r.status_code == 429 and "used up" in r.json()["reason"]
    assert len(router.calls) == 1


async def test_short_extract_falls_back_to_search_without_time_range(tmp_path):
    pc = PageClient("Log in to continue")
    app, _ = make(tmp_path, pc)
    async with client(app) as c:
        r = await c.post("/api/profile/parse", json={"url": "https://www.google.com/maps/place/Cafe+Sao/@10.7,106.7"})
    src = r.json()["source"]
    assert r.status_code == 200 and src["method"] == "search" and src["credits"] == 2
    assert "time_range" not in pc.searches[0] and pc.searches[0]["topic"] == "general"
    assert "Cafe Sao" in pc.searches[0]["query"]


async def test_both_reads_empty_is_422(tmp_path):
    app, router = make(tmp_path, PageClient("", results=[]))
    async with client(app) as c:
        r = await c.post("/api/profile/parse", json={"url": "https://facebook.com/nothing"})
    assert r.status_code == 422 and "Couldn't read that page" in r.json()["reason"] and not router.calls


async def test_bad_urls_are_422(tmp_path):
    app, _ = make(tmp_path, PageClient(LONG))
    async with client(app) as c:
        for bad in ("ftp://a.com/x", "http://localhost:3000", "http://127.0.0.1/", "http://192.168.1.5/a",
                    "https://intranet/x", "https://a.com/" + "x" * 500):
            r = await c.post("/api/profile/parse", json={"text": "my cafe", "url": bad})
            assert r.status_code == 422 and r.json()["reason"], bad


async def test_text_only_is_unchanged(tmp_path):
    pc = PageClient(LONG)
    app, _ = make(tmp_path, pc)
    async with client(app) as c:
        r = await c.post("/api/profile/parse", json={"text": "I run a cafe"})
    assert r.status_code == 200 and r.json()["source"] is None and not pc.extracts
    assert profile_parser_messages("I run a cafe")[1]["content"] == "Business description:\nI run a cafe"


def test_page_goes_in_as_data_beside_the_note():
    msg = profile_parser_messages("note", {"url": "https://a.com", "title": "A", "text": "body"})[1]["content"]
    assert msg == "Owner's note:\nnote\n\nFrom their web page https://a.com (A):\nbody"
    assert "(none)" in profile_parser_messages("", {"url": "u", "title": "", "text": "b"})[1]["content"]


async def test_search_time_range_none_is_left_out(tmp_path):
    pc = PageClient()
    sc = TavilyScout(tmp_path, client=pc)
    await sc.search("q", "basic", None, topic="general")
    await sc.search("q", "basic")
    assert "time_range" not in pc.searches[0] and pc.searches[1]["time_range"] == "week"


def test_search_query_names_the_shop_not_the_platform():
    from backend.services.tavily_scout import _search_query_for as q

    assert q("https://www.facebook.com/tartinebakery") == "tartinebakery facebook page"
    assert q("https://www.google.com/maps/place/Tartine+Bakery/@37.7614,-122.4241,17z") == "Tartine Bakery business"
    assert q("https://cafesao.vn/menu") == "cafesao.vn menu"
