"""USDA NASS QuickStats: reported yields, prices received and planting and harvest progress."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import numpy as np

from app.adapters.base import Fetcher, FetchError

API_URL = "https://quickstats.nass.usda.gov/api/api_GET/"
SQUARE_METRES_PER_ACRE = 4046.8564224
ACRES_PER_HECTARE = 10_000 / SQUARE_METRES_PER_ACRE
# USDA standard bushel weights, pounds.
POUNDS_PER_BUSHEL = {"CORN": 56.0, "SORGHUM": 56.0, "WHEAT": 60.0, "SOYBEANS": 60.0}


@dataclass(frozen=True)
class Commodity:
    """How one crop is named in QuickStats."""

    commodity: str
    class_desc: str = "ALL CLASSES"
    util: str = "ALL UTILIZATION PRACTICES"


@dataclass
class Reported:
    values: dict[int, float]
    unit: str
    level: str

    def recent(self, n: int = 10) -> np.ndarray:
        return np.array([self.values[year] for year in sorted(self.values)[-n:]], dtype=float)

    @property
    def period(self) -> tuple[str, str]:
        years = sorted(self.values)
        return f"{years[0]}-01-01", f"{years[-1]}-12-31"


def _rows(fetcher: Fetcher, key: str, **params: object) -> list[dict]:
    try:
        return fetcher.get_json("nass_quickstats", API_URL, params={"key": key, "format": "JSON", **params}, max_age_days=30).get("data", [])
    except FetchError as error:
        # QuickStats answers a query with no rows as HTTP 400.
        if "HTTP 400" in str(error):
            return []
        raise


def _series(rows: list[dict], commodity: Commodity) -> tuple[dict[int, float], str | None]:
    values: dict[int, float] = {}
    unit = None
    for row in rows:
        if row.get("class_desc") != commodity.class_desc or row.get("util_practice_desc") != commodity.util:
            continue
        if row.get("prodn_practice_desc") != "ALL PRODUCTION PRACTICES" or row.get("domain_desc") != "TOTAL":
            continue
        try:
            values[int(row["year"])] = float(str(row["Value"]).replace(",", ""))
        except (KeyError, ValueError):
            continue
        unit = row.get("unit_desc")
    return values, unit


def yields(fetcher: Fetcher, key: str, commodity: Commodity, state_fips: str, county_code: str, *, since: int = 2010) -> list[Reported]:
    """Reported yields, the county's first and then the state's, for the caller to pair with prices."""
    common = {"commodity_desc": commodity.commodity, "statisticcat_desc": "YIELD", "source_desc": "SURVEY", "year__GE": since, "state_fips_code": state_fips}
    found = []
    for level, extra in (("county", {"agg_level_desc": "COUNTY", "county_code": county_code}), ("state", {"agg_level_desc": "STATE"})):
        values, unit = _series(_rows(fetcher, key, **common, **extra), commodity)
        if values and unit:
            found.append(Reported(values, unit, level))
    return found


def prices(fetcher: Fetcher, key: str, commodity: Commodity, state_fips: str, *, since: int = 2015) -> Reported | None:
    rows = _rows(fetcher, key, commodity_desc=commodity.commodity, statisticcat_desc="PRICE RECEIVED", agg_level_desc="STATE",
                 state_fips_code=state_fips, freq_desc="ANNUAL", reference_period_desc="MARKETING YEAR", year__GE=since)
    values, unit = _series(rows, commodity)
    return Reported(values, unit, "state") if len(values) >= 3 and unit else None


def revenue_per_hectare(commodity: Commodity, yield_value: float, yield_unit: str, price_value: float, price_unit: str) -> float | None:
    """Gross revenue in USD per hectare from a reported yield and a reported price, or None if the units do not pair."""
    amount, _, per = yield_unit.partition(" / ")
    money, _, price_per = price_unit.partition(" / ")
    if per != "ACRE" or money != "$":
        return None
    if amount == price_per:
        per_acre = yield_value * price_value
    elif amount == "BU" and price_per == "CWT" and commodity.commodity in POUNDS_PER_BUSHEL:
        per_acre = yield_value * POUNDS_PER_BUSHEL[commodity.commodity] / 100.0 * price_value
    elif amount == "LB" and price_per == "CWT":
        per_acre = yield_value / 100.0 * price_value
    elif amount == "TONS" and price_per == "TON":
        per_acre = yield_value * price_value
    else:
        return None
    return per_acre * ACRES_PER_HECTARE


def progress_day(fetcher: Fetcher, key: str, commodity: Commodity, unit: str, state_fips: str, *, since: int = 2015,
                 percent: float = 50.0) -> tuple[float, float, float, int] | None:
    """Day of year when a given share of the state's crop (half, unless told otherwise) had reached a stage:
    median across years, with the 10th and 90th percentile years."""
    rows = _rows(fetcher, key, commodity_desc=commodity.commodity, statisticcat_desc="PROGRESS", unit_desc=unit, state_fips_code=state_fips,
                 agg_level_desc="STATE", year__GE=since)
    by_year: dict[int, list[tuple[int, float]]] = {}
    for row in rows:
        if row.get("class_desc") != commodity.class_desc:
            continue
        try:
            week = date.fromisoformat(row["week_ending"])
            by_year.setdefault(int(row["year"]), []).append((week.timetuple().tm_yday + (365 if week.year > int(row["year"]) else 0), float(row["Value"])))
        except (KeyError, ValueError):
            continue
    halves = []
    for points in by_year.values():
        points.sort()
        days = np.array([p[0] for p in points], dtype=float)
        percents = np.array([p[1] for p in points], dtype=float)
        if percents.max() < percent or percents.min() > percent or len(points) < 2:
            continue
        halves.append(float(np.interp(percent, percents, days)))
    if len(halves) < 3:
        return None
    return float(np.median(halves)), float(np.percentile(halves, 10)), float(np.percentile(halves, 90)), len(halves)
