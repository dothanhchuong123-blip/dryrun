"""Dates for backtests (B1, SPEC §15.12): what may a run "know" on its as-of date?

Pure functions. `later_dated` finds dates after the as-of date in a piece of text; `url_date` reads the date a news
URL carries in its path; `usable_result` is the news filter (a search result with no `published_date`, a later one, or
a URL or title dated after `as_of` is dropped). The leak check in `backend.sim.backtest` uses `later_dated` too.
"""
from __future__ import annotations

import re
from datetime import UTC, date, datetime
from email.utils import parsedate_to_datetime
from typing import Any

_MONTHS = {
    m: i for i, names in enumerate(
        ("january jan", "february feb", "march mar", "april apr", "may", "june jun", "july jul", "august aug",
         "september sep sept", "october oct", "november nov", "december dec"), start=1,
    ) for m in names.split()
}
_MONTH_NAMES = "|".join(sorted(_MONTHS, key=len, reverse=True))
# "April 2024", "Apr. 12, 2024", "12 April 2024", "April 12th, 2024"
_MONTH_YEAR = re.compile(
    rf"(?i)\b(?:(\d{{1,2}})(?:st|nd|rd|th)?\s+)?({_MONTH_NAMES})\b\.?(?:\s+(\d{{1,2}})(?:st|nd|rd|th)?)?,?\s+(20\d\d)\b"
)
_ISO = re.compile(r"\b(20\d\d)-(\d\d)-(\d\d)\b")
_YEAR = re.compile(r"\b(20\d\d)\b")
_URL_YMD = re.compile(r"[/_-](20\d\d)[/_-]?(0[1-9]|1[0-2])[/_-]?(0[1-9]|[12]\d|3[01])(?!\d)")
_URL_YM = re.compile(r"/(20\d\d)/(0[1-9]|1[0-2])(?:/|$)")
_URL_Y = re.compile(r"/(20\d\d)(?:/|$)")


def _after(year: int, month: int | None, day: int | None, as_of: date) -> bool:
    if year != as_of.year:
        return year > as_of.year
    if month is None:
        return False
    if month != as_of.month:
        return month > as_of.month
    return day is not None and day > as_of.day


def later_dated(text: str, as_of: date, *, bare_years: bool = False) -> list[str]:
    """The pieces of `text` that name a date after `as_of`: "April 2024", "12 April 2024", "2024-04-12".

    With `bare_years` a lone year after the as-of year ("2025") counts too (the leak check wants that; the news
    filter does not, because a January 2024 article may talk about "2025 forecasts")."""
    hits: list[str] = []
    for m in _MONTH_YEAR.finditer(text):
        day = m.group(1) or m.group(3)
        if _after(int(m.group(4)), _MONTHS[m.group(2).lower()], int(day) if day else None, as_of):
            hits.append(m.group(0))
    for m in _ISO.finditer(text):
        if _after(int(m.group(1)), int(m.group(2)), int(m.group(3)), as_of):
            hits.append(m.group(0))
    if bare_years:
        seen = " ".join(hits)
        hits += [m.group(0) for m in _YEAR.finditer(text) if int(m.group(1)) > as_of.year and m.group(0) not in seen]
    return hits


def url_date(url: str) -> tuple[int, int | None, int | None] | None:
    """(year, month, day) a URL's path carries (`/2024/04/12/`, `2024-04-12`, `/2024/04/`, `/2024/`), or None."""
    for pat in (_URL_YMD, _URL_YM, _URL_Y):
        m = pat.search(url)
        if m:
            g = [int(x) for x in m.groups()]
            return g[0], (g[1] if len(g) > 1 else None), (g[2] if len(g) > 2 else None)
    return None


def published_day(raw: Any) -> date | None:
    """A Tavily `published_date` (RFC 2822 or ISO) as a date; None when missing or unreadable."""
    if not raw:
        return None
    try:
        return parsedate_to_datetime(str(raw)).astimezone(UTC).date()
    except (TypeError, ValueError):
        pass
    try:
        return datetime.fromisoformat(str(raw)).date()
    except ValueError:
        return None


def usable_result(result: dict, as_of: date) -> bool:
    """The backtest news filter: a dated result on or before `as_of`, whose URL and title don't say otherwise."""
    published = published_day(result.get("published_date"))
    if published is None or published > as_of:
        return False
    ud = url_date(str(result.get("url", "")))
    if ud is not None and _after(*ud, as_of):
        return False
    return not later_dated(str(result.get("title", "")), as_of)
