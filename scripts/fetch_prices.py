# /// script
# requires-python = ">=3.11"
# dependencies = ["openpyxl>=3.1"]
# ///
"""Download the price series the B1 backtests score against and save them as CSVs under fixtures/prices/.

    uv run scripts/fetch_prices.py                 # every series
    uv run scripts/fetch_prices.py palm_oil ...    # only these (leaves the frozen B1 series untouched)

- World Bank Pink Sheet, monthly prices (CMO-Historical-Data-Monthly.xlsx, CC BY 4.0): Cocoa, Coffee Robusta,
  Coffee Arabica in $/kg, plus the held-out cases' Palm oil, Sunflower oil, Wheat HRW and Rice Viet Nam 5% in
  $/mt. The xlsx goes to a temp folder and is not kept.
- BLS series APU0000708111 (US city average, eggs grade A large, $/dozen) through the public API v1 (no key).
Each CSV starts with `#` comment lines (source URL, licence, retrieval date) and then `month,value`
(month = YYYY-MM-01). A month the source marks unavailable is left out.
"""
import csv
import json
import sys
import tempfile
import urllib.request
from datetime import date
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "fixtures" / "prices"
FIRST_YEAR = 2023
PINK_URL = (
    "https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/"
    "CMO-Historical-Data-Monthly.xlsx"
)
PINK_PAGE = "https://www.worldbank.org/en/research/commodity-markets"
BLS_URL = "https://api.bls.gov/publicAPI/v1/timeseries/data/"
BLS_SERIES = "APU0000708111"
PINK_COLUMNS = {"cocoa": "Cocoa", "coffee_robusta": "Coffee, Robusta", "coffee_arabica": "Coffee, Arabica"}
# Held-out backtest series (fixtures/backtests/ho_*.json): column -> unit, and from 2021 so the 2021-22 cases fit.
HELD_OUT_COLUMNS = {
    "palm_oil": ("Palm oil", "($/mt)"),
    "sunflower_oil": ("Sunflower oil", "($/mt)"),
    "wheat_hrw": ("Wheat, US HRW", "($/mt)"),
    "rice_vn5": ("Rice, Viet Namese 5%", "($/mt)"),
    "coffee_arabica_2021": ("Coffee, Arabica", "($/kg)"),
}
HELD_OUT_FIRST_YEAR = 2021


def _fetch(url: str, data: bytes | None = None, headers: dict | None = None) -> bytes:
    req = urllib.request.Request(url, data=data, headers=headers or {"User-Agent": "dryrun-backtest/1.0"})
    with urllib.request.urlopen(req, timeout=90) as r:  # noqa: S310  fixed https URLs above
        return r.read()


def _write(name: str, header: list[str], rows: list[tuple[str, float]]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.csv"
    with path.open("w", encoding="utf-8", newline="") as f:
        for line in header:
            f.write(f"# {line}\n")
        w = csv.writer(f)
        w.writerow(["month", "value"])
        w.writerows(rows)
    print(f"wrote {path.relative_to(ROOT)} ({len(rows)} months, {rows[0][0]} to {rows[-1][0]})")


def pink_sheet(today: str, only: set[str] | None = None) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        xlsx = Path(tmp) / "CMO.xlsx"
        xlsx.write_bytes(_fetch(PINK_URL))
        wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)
        rows = list(wb["Monthly Prices"].iter_rows(values_only=True))
    head = next(r for r in rows if r and "Cocoa" in [str(x) for x in r if x])
    units = rows[rows.index(head) + 1]
    series = {n: (c, "($/kg)", FIRST_YEAR) for n, c in PINK_COLUMNS.items()}
    series |= {n: (c, u, HELD_OUT_FIRST_YEAR) for n, (c, u) in HELD_OUT_COLUMNS.items()}
    for name, (column, unit, first_year) in series.items():
        if only is not None and name not in only:
            continue
        col = [str(x).strip() if x else "" for x in head].index(column)
        assert units[col] == unit, (column, units[col])
        out = []
        for r in rows:
            tag = str(r[0] or "")
            if len(tag) == 7 and tag[4] == "M" and tag[:4].isdigit() and int(tag[:4]) >= first_year:
                if isinstance(r[col], int | float):
                    out.append((f"{tag[:4]}-{tag[5:]}-01", float(r[col])))
        _write(
            name,
            [
                f"World Bank Commodity Price Data (The Pink Sheet), monthly prices, column '{column}', "
                f"{unit.strip('()')} nominal",
                f"Source: {PINK_PAGE} (file {PINK_URL})",
                "Licence: CC BY 4.0",
                f"Retrieved: {today}",
            ],
            out,
        )


def eggs(today: str) -> None:
    body = json.dumps(
        {"seriesid": [BLS_SERIES], "startyear": str(FIRST_YEAR), "endyear": str(date.today().year)}
    ).encode()
    resp = json.loads(_fetch(BLS_URL, body, {"Content-Type": "application/json"}))
    data = resp["Results"]["series"][0]["data"]
    out = sorted(
        (f"{d['year']}-{d['period'][1:]}-01", float(d["value"]))
        for d in data
        if d["period"].startswith("M") and d["period"] != "M13" and d["value"] not in ("-", "")
    )
    _write(
        "eggs_bls",
        [
            "BLS Average Price Data, series APU0000708111: US city average, eggs, grade A, large, per dozen, $",
            "Source: https://data.bls.gov/timeseries/APU0000708111 (public API v1, " + BLS_URL + ")",
            "Licence: US Government work, public domain (BLS)",
            "Retail price. Months BLS marks unavailable (Oct 2025, the 2025 lapse in appropriations) are left out.",
            f"Retrieved: {today}",
        ],
        out,
    )


if __name__ == "__main__":
    stamp = date.today().isoformat()
    names = set(sys.argv[1:]) or None
    pink_sheet(stamp, names)
    if names is None or "eggs_bls" in names:
        eggs(stamp)
