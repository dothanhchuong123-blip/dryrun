"""A pasted shop link whose page is thin: Tavily Map finds the menu pages, one more Extract reads them, at most 3 credits."""
import pytest

from backend.services.tavily_scout import MAX_PAGE_CREDITS, OfflineCacheMiss, TavilyScout, is_thin, menu_pages

HOME = "https://cafesao.vn/"
MENU = "Espresso 45,000 VND. Phin sua da 39,000 VND. Cold brew 55,000 VND. Banh mi 30,000 VND. " * 4


class SiteClient:
    """A shop whose home page says almost nothing and whose /menu page has the prices."""

    def __init__(self, mapped=None, home="Cafe Sao. Saigon.", menu=MENU, map_fails=False):
        self.mapped = mapped if mapped is not None else [
            "https://cafesao.vn/", "https://cafesao.vn/menu", "https://cafesao.vn/about", "https://cafesao.vn/products/beans",
            "https://other.com/menu",
        ]
        self.home, self.menu, self.map_fails = home, menu, map_fails
        self.extracts, self.maps, self.searches = [], [], []

    async def extract(self, **kw):
        self.extracts.append(kw)
        rows = []
        for u in kw["urls"]:
            text = self.home if u == HOME else self.menu
            if text:
                rows.append({"url": u, "title": "Cafe Sao", "raw_content": text})
        return {"results": rows}

    async def map(self, url, **kw):
        self.maps.append((url, kw))
        if self.map_fails:
            raise RuntimeError("map blocked")
        return {"base_url": url, "results": self.mapped}

    async def search(self, **kw):
        self.searches.append(kw)
        return {"results": [{"url": "https://x.com", "title": "Cafe Sao", "content": "A cafe in Saigon with slow coffee."}]}


def scout(tmp_path, client):
    return TavilyScout(tmp_path, client=client)


def test_what_counts_as_thin():
    assert is_thin("Cafe Sao. Saigon.")                      # under 200
    assert is_thin("About us " * 40)                         # 360 chars and no price
    assert not is_thin("Espresso 45,000 VND " * 15)          # a price on it
    assert not is_thin("A long page about slow coffee. " * 40)


def test_menu_pages_picks_same_site_menu_like_paths_best_first():
    urls = ["https://cafesao.vn/", "https://cafesao.vn/about", "https://cafesao.vn/products/beans", "https://cafesao.vn/menu",
            "https://www.cafesao.vn/thuc-don/ca-phe", "https://other.com/menu", "ftp://cafesao.vn/menu"]
    assert menu_pages(urls, HOME) == ["https://cafesao.vn/menu", "https://www.cafesao.vn/thuc-don/ca-phe"]
    assert menu_pages(["https://cafesao.vn/about"], HOME) == []


async def test_thin_home_page_reads_the_menu_pages_within_three_credits(tmp_path):
    c = SiteClient()
    sc = scout(tmp_path, c)
    read = await sc.read_page(HOME)
    assert read is not None and read.method == "map" and "Espresso 45,000 VND" in read.text and "Cafe Sao. Saigon." in read.text
    assert read.credits == 3 == MAX_PAGE_CREDITS                # extract 1 + map 1 + extract of the menu pages 1
    url, kw = c.maps[0]
    assert url == HOME and kw["limit"] == 10 and kw["max_depth"] == 1 and kw["allow_external"] is False and "instructions" not in kw
    assert c.extracts[1]["urls"] == ["https://cafesao.vn/menu", "https://cafesao.vn/products/beans"]
    assert c.searches == []                                     # no Search fallback needed
    again = await scout(tmp_path, SiteClient(menu="", mapped=[])).read_page(HOME)   # all cached now: nothing is asked again
    assert again is not None and again.method == "map" and again.credits == 0


async def test_a_good_home_page_never_calls_map(tmp_path):
    c = SiteClient(home=MENU)
    read = await scout(tmp_path, c).read_page(HOME)
    assert read.method == "extract" and read.credits == 1 and c.maps == []


async def test_no_menu_links_falls_back_to_search_within_budget(tmp_path):
    c = SiteClient(mapped=["https://cafesao.vn/about"])
    sc = scout(tmp_path, c)
    read = await sc.read_page(HOME)
    assert read is not None and read.method == "search" and read.credits == 3     # extract + map + search
    assert len(c.extracts) == 1 and len(c.searches) == 1


async def test_map_failure_keeps_extract_and_search_working(tmp_path):
    c = SiteClient(map_fails=True)
    read = await scout(tmp_path, c).read_page(HOME)
    assert read is not None and read.method == "search" and read.credits <= MAX_PAGE_CREDITS


async def test_menu_pages_still_thin_stop_at_three_credits(tmp_path):
    c = SiteClient(menu="Menu soon.")
    read = await scout(tmp_path, c).read_page(HOME)
    assert read is not None and read.credits == 3 and c.searches == []            # no fourth credit
    assert "Menu soon." in read.text


async def test_offline_cache_miss_still_raises(tmp_path):
    sc = TavilyScout(tmp_path, client=SiteClient(), offline=True)
    with pytest.raises(OfflineCacheMiss):
        await sc.read_page(HOME)
