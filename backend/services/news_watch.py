"""News for one business: supply headlines turned into shocks, plus local-market context (SPEC §15.7).

`NewsWatch.find` searches each of the profile's queries, drops pages that aren't articles, has Super parse
the top 3 supply articles into shock numbers with verbatim quotes (dropping social posts, and any cost change
whose quote says the opposite), and scores every headline by what it would
do to "Do nothing" (the engine, never an LLM). `NewsWatch.check` is the "Check live news" button: one fresh
search, one article, one card with `live: true, applied: false`.
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import urlparse

import numpy as np

from backend.agents import wording
from backend.agents.prompts import ASSUMPTION_SOURCE, shock_parser_messages
from backend.agents.schemas import ShockVector
from backend.engine import planner
from backend.services.tavily_scout import verify_evidence

log = logging.getLogger(__name__)

# Pages that are indexes, tickers or sitemaps, not articles (FEEDBACK_LOG 2026-10-14). Dropped before any extract.
NON_ARTICLE = re.compile(r"(?i)/sitemap|/tag/|/tags/|/page/\d+|/index(\.html?)?$|/quote/|/ticker|/markets/data")
# Social posts are promos and personal updates, not reporting (FEEDBACK_LOG 2026-10-15). Dropped like non-articles.
SOCIAL_DOMAINS = (
    "instagram.com", "facebook.com", "fb.com", "fb.watch", "tiktok.com", "twitter.com", "x.com", "threads.net",
    "youtube.com", "youtu.be", "pinterest.com", "reddit.com", "linkedin.com",
)
# Movement words, for checking that a parsed cost change goes the way its quote says. Level words ("record high")
# don't count: "prices hit record highs, then retreated" is a fall.
_UP = re.compile(
    r"(?i)\b(?:rise[sn]?|rising|rose|surg\w*|soar\w*|jump\w*|climb\w*|increas\w*|spik\w*|rall(?:y|ied|ies)|higher|"
    r"up \d|tăng)\b"
)
_DOWN = re.compile(
    r"(?i)\b(?:fall(?:s|en|ing)?|fell|drop\w*|declin\w*|retreat\w*|eas(?:e|ed|es|ing)|slump\w*|plung\w*|"
    r"slid(?:e|es|ing)?|tumbl\w*|lower(?:ed|ing|s)?|dip(?:s|ped)?|down \d|cheaper|giảm)\b"
)
MIN_SNIPPET = 80          # a search result whose snippet is this short or shorter is dropped
MAX_CREDITS = 5           # per analysis: searches (1 each, basic) plus one extract call
MAX_SUPPLY_SEARCHES, MAX_MARKET_SEARCHES = 3, 2
KEEP_SUPPLY, KEEP_MARKET, PARSE_TOP = 5, 3, 3
IMPACT_PATHS = 500
HORIZON = 24
MAX_QUOTE = 300
MAX_SNIPPET = 200


def _source(url: str) -> str:
    host = urlparse(url).netloc.lower()
    return host.removeprefix("www.")


def _published(raw: Any) -> str:
    """Tavily gives an RFC 2822 date; the UI wants an ISO date. Anything unparseable becomes ""."""
    if not raw:
        return ""
    try:
        return parsedate_to_datetime(str(raw)).astimezone(UTC).date().isoformat()
    except (TypeError, ValueError):
        pass
    try:
        return datetime.fromisoformat(str(raw)).date().isoformat()
    except ValueError:
        return ""


def exact_span(quote: str, text: str) -> str | None:
    """The real substring of `text` that `quote` matches ignoring case and runs of whitespace, or None.

    `verify_evidence` accepts case- and whitespace-insensitive matches; the UI shows the article's own words.
    """
    words = quote.split()
    if not words:
        return None
    m = re.search(r"\s+".join(re.escape(w) for w in words), text, flags=re.IGNORECASE)
    return m.group(0) if m else None


def is_social(url: str) -> bool:
    host = _source(url)
    return any(host == d or host.endswith("." + d) for d in SOCIAL_DOMAINS)


def direction(text: str) -> int:
    """+1 if the text only says something went up, -1 if it only says down, 0 if both, neither or unclear."""
    up, down = bool(_UP.search(text)), bool(_DOWN.search(text))
    return 0 if up == down else (1 if up else -1)


def contradicts(delta: float, quotes: list[str]) -> bool:
    """True when a parsed change has the opposite sign to what its quotes say (e.g. +5% from "prices retreated")."""
    d = direction(" ".join(quotes))
    return (delta > 0 and d < 0) or (delta < 0 and d > 0)


def _usable(r: dict) -> bool:
    url = r.get("url")
    return (
        bool(url) and not NON_ARTICLE.search(url) and not is_social(url)
        and len(str(r.get("content", "")).strip()) > MIN_SNIPPET
    )


def _wrong_way(shock: ShockVector) -> bool:
    if contradicts(shock.delta_c_raw, [ev.quote for ev in shock.evidence]):
        log.info("news: dropped a parsed cost change of %+.0f%% that its quote contradicts", shock.delta_c_raw * 100)
        return True
    return False


def _merge(batches: list[list[dict]]) -> list[dict]:
    """Merge result lists, one entry per URL (best score wins), best score first."""
    best: dict[str, dict] = {}
    for results in batches:
        for r in results:
            url = r.get("url")
            if url and (url not in best or (r.get("score") or 0) > (best[url].get("score") or 0)):
                best[url] = r
    return sorted(best.values(), key=lambda r: -(r.get("score") or 0))


def _case(knobs: dict) -> planner.ShockCase:
    return planner.ShockCase(
        id="news", label="", delta_c_raw=knobs["delta_c_raw"], delta_lead_time=knobs["delta_lead_time"],
        demand_shock=knobs["demand_shock"], likelihood="likely", origin="news",
    ).clamp()


class _Impact:
    """Do-nothing profit under a headline's shock minus do-nothing with no shock, per path, same random numbers."""

    def __init__(self, cal: planner.Calibration, n_paths: int = IMPACT_PATHS, seed: int = 0) -> None:
        self.cal, self.n, self.seed = cal, n_paths, seed
        self._base: np.ndarray | None = None

    def _profit(self, case: planner.ShockCase) -> np.ndarray:
        # _run_column is the engine's per-path runner; evaluate_cell only reports a plan against Do nothing.
        parts = planner._run_column(self.cal, [planner.PlanSpec.do_nothing()], case, {}, HORIZON, self.n, self.seed, False)
        return parts[0]["profit_b"]

    def __call__(self, knobs: dict) -> tuple[float, float]:
        if self._base is None:
            self._base = self._profit(planner.ShockCase(id="none", label="No change"))
        diff = (self._profit(_case(knobs)) - self._base) * self.cal.usd
        return float(diff.mean()), float(np.percentile(diff, 5))


class NewsWatch:
    def __init__(self, scout: Any, router: Any) -> None:
        self.scout = scout
        self.router = router
        self._live_n = 0

    # --- search ------------------------------------------------------------------------------
    async def _search(self, query: str, *, time_range: str, topic: str, country: str, live: bool, fresh: bool = False) -> list[dict]:
        try:
            resp = await self.scout.search(
                query, "basic", time_range, use_cache=not fresh, topic=topic, country=country, cache_only=not live,
            )
        except Exception as e:  # noqa: BLE001  Tavily down, offline cache miss, timeout: the analysis goes on
            log.info("news search failed for %r: %s", query, e)
            return []
        return [r for r in resp.get("results", []) if isinstance(r, dict)]

    async def _articles(self, results: list[dict], query: str, *, live: bool, fresh: bool = False) -> list[dict]:
        if not results:
            return []
        urls = [r["url"] for r in results]
        try:
            er = await self.scout.extract(urls, query, use_cache=not fresh, cache_only=not live)
        except Exception as e:  # noqa: BLE001
            log.info("news extract failed: %s", e)
            return []
        titles = {r["url"]: r.get("title", "") for r in results}
        return [
            {"url": e["url"], "title": titles.get(e["url"], ""), "content": e.get("raw_content") or ""}
            for e in er.get("results", [])
            if e.get("raw_content")
        ]

    async def _parse(self, article: dict, profile: dict) -> ShockVector | None:
        hint = (
            f'{profile.get("business_name", "")} sells {profile.get("product_unit", "")} '
            f'(supplier region: {profile.get("supplier_region", "")}). '
            "delta_c_raw is the change in the price of the main INPUT as the article reports it."
        )
        res = await self.router.call(
            "super", shock_parser_messages([article], hint), ShockVector, thinking=False, role="shock_parser"
        )
        if res.parsed is None:
            return None
        return verify_evidence(res.parsed, [article])

    # --- items -------------------------------------------------------------------------------
    @staticmethod
    def _knobs(shock: ShockVector | dict) -> dict:
        get = shock.get if isinstance(shock, dict) else lambda k: getattr(shock, k)
        return {k: get(k) for k in ("delta_c_raw", "delta_lead_time", "demand_shock")}

    def _supply_item(
        self, item_id: str, article: dict, shock: ShockVector, published: str, profile: dict, impact: _Impact,
        *, live: bool,
    ) -> dict:
        knobs = self._knobs(shock)
        quote = next((s for ev in shock.evidence if (s := exact_span(ev.quote, article["content"]))), None)
        mean, p5 = impact(knobs)
        return {
            "id": item_id, "kind": "supply", "title": article["title"], "url": article["url"],
            "source": _source(article["url"]), "published": published, "quote": (quote or "")[:MAX_QUOTE],
            "shock": knobs, "cost_line": wording.cost_line(profile, _case(knobs)),
            "impact_usd": round(mean, 2), "impact_p5_usd": round(p5, 2), "live": live, "applied": False,
        }

    def _fallback_item(self, profile: dict, fallback_shock: dict, impact: _Impact) -> dict:
        knobs = self._knobs(fallback_shock)
        evidence = fallback_shock.get("evidence") or [{}]
        quote = evidence[0].get("quote", "") if isinstance(evidence[0], dict) else getattr(evidence[0], "quote", "")
        mean, p5 = impact(knobs)
        return {
            "id": "n1", "kind": "supply", "title": "Example assumption (no live article found)", "url": "",
            "source": ASSUMPTION_SOURCE, "published": "", "quote": str(quote)[:MAX_QUOTE], "shock": knobs,
            "cost_line": wording.cost_line(profile, _case(knobs)), "impact_usd": round(mean, 2),
            "impact_p5_usd": round(p5, 2), "live": False, "applied": True,
        }

    # --- public API --------------------------------------------------------------------------
    async def find(
        self, profile: dict, *, fallback_shock: dict, live: bool, fresh: bool = False, pin_assumption: bool = False,
    ) -> dict:
        """`{items, used_for_grid, news_shock, credits, dropped}`; `items` match the `news` event (EVENTS v2.1).

        `live=False` reads the Tavily cache only (REPLAY); `live=True` may spend credits on a cache miss.
        `fresh=True` (with `live`) skips the cache and overwrites it with today's results.
        `pin_assumption=True` (the example recordings) always uses the example's labelled assumption for the `news`
        column; the articles found are still shown as cards, never applied.
        """
        fresh = fresh and live
        before = self.scout.credits_used
        impact = _Impact(planner.calibrate(profile))
        n_supply = min(len(profile.get("search_terms", [])), MAX_SUPPLY_SEARCHES)
        n_market = min(len(profile.get("market_terms", [])), MAX_MARKET_SEARCHES)
        while n_supply + n_market + 1 > MAX_CREDITS:  # +1 for the extract call
            if n_supply > 1:
                n_supply -= 1
            else:
                n_market -= 1
        country = str(profile.get("country", "") or "")
        supply_q = list(profile.get("search_terms", []))[:n_supply]
        market_q = list(profile.get("market_terms", []))[:n_market]
        supply_batches, market_batches = await asyncio.gather(
            asyncio.gather(*(self._search(q, time_range="week", topic="news", country="", live=live, fresh=fresh) for q in supply_q)),
            asyncio.gather(*(self._search(q, time_range="month", topic="general", country=country, live=live, fresh=fresh)
                             for q in market_q)),
        )
        supply_all, market_all = _merge(list(supply_batches)), _merge(list(market_batches))
        supply = [r for r in supply_all if _usable(r)][:KEEP_SUPPLY]
        market = [r for r in market_all if _usable(r)][:KEEP_MARKET]
        dropped = (len(supply_all) - len([r for r in supply_all if _usable(r)])) + (
            len(market_all) - len([r for r in market_all if _usable(r)])
        )
        if dropped:
            log.info("news: dropped %d non-article or too-short results before extract", dropped)

        top = supply[:PARSE_TOP]
        articles = await self._articles(top, supply_q[0] if supply_q else "", live=live, fresh=fresh)
        by_url = {r["url"]: r for r in top}
        parsed = await asyncio.gather(*(self._parse(a, profile) for a in articles))
        items: list[dict] = []
        for article, shock in zip(articles, parsed, strict=True):
            if shock is None or _wrong_way(shock):
                continue
            published = _published(by_url[article["url"]].get("published_date"))
            item = await asyncio.to_thread(
                self._supply_item, f"n{len(items) + 1}", article, shock, published, profile, impact, live=False
            )
            if item["quote"] and any(item["shock"].values()):  # a headline that moves nothing says nothing
                items.append(item)
        if not items or pin_assumption:
            items = [await asyncio.to_thread(self._fallback_item, profile, fallback_shock, impact), *items]
            for i, it in enumerate(items, 1):
                it["id"] = f"n{i}"
            used = items[0]
        else:
            used = max(items, key=lambda it: abs(it["impact_usd"]))
            used["applied"] = True
        market_items = [
            {
                "id": f"m{i}", "kind": "market", "title": r.get("title", ""), "url": r["url"], "source": _source(r["url"]),
                "published": _published(r.get("published_date")), "quote": str(r.get("content", "")).strip()[:MAX_SNIPPET],
                "shock": None, "cost_line": None, "impact_usd": None, "impact_p5_usd": None, "live": False, "applied": False,
            }
            for i, r in enumerate(market, 1)
        ]
        return {
            "items": [*items, *market_items],
            "used_for_grid": used["id"],
            "news_shock": dict(used["shock"]),
            "credits": self.scout.credits_used - before,
            "dropped": dropped,
        }

    async def check(self, profile: dict) -> dict:
        """"Check live news": one fresh `basic` search, extract and parse. `{items: [0 or 1 card], credits, reason?}`."""
        if getattr(self.scout, "offline", False):
            return {"items": [], "credits": 0, "reason": "offline"}
        before = self.scout.credits_used
        query = (profile.get("search_terms") or [""])[0]
        results = [r for r in await self._search(query, time_range="week", topic="news", country="", live=True, fresh=True) if _usable(r)]
        results = _merge([results])[:PARSE_TOP]
        articles = await self._articles(results, query, live=True, fresh=True)
        by_url = {r["url"]: r for r in results}
        impact = _Impact(planner.calibrate(profile))
        for article in articles:
            shock = await self._parse(article, profile)
            if shock is None or _wrong_way(shock):
                continue
            self._live_n += 1
            item = await asyncio.to_thread(
                self._supply_item, f"live{self._live_n}", article, shock,
                _published(by_url[article["url"]].get("published_date")), profile, impact, live=True,
            )
            if item["quote"]:
                return {"items": [item], "credits": self.scout.credits_used - before}
        return {"items": [], "credits": self.scout.credits_used - before, "reason": "no usable article"}
