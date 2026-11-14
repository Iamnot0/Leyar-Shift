"""National yields and farm-gate prices reported to FAO, from the snapshot in backend/data/faostat.

The snapshot is built by development/sandbox/scripts/ingest_faostat.py. Nothing here estimates or carries a
value forward: a crop with no recent reported price gets no money figure.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from app.adapters.nass import Reported
from app.core import config


@dataclass(frozen=True)
class Currency:
    code: str
    name: str


@dataclass(frozen=True)
class CountryIncome:
    yields: Reported
    prices: Reported
    years: list[int]


@lru_cache
def _snapshot(path: Path) -> dict:
    return json.loads(path.read_text()) if path.exists() else {}


def _country(processed_dir: Path, m49: str | None) -> dict | None:
    return _snapshot(processed_dir / "faostat" / "faostat.json").get("countries", {}).get(m49 or "")


def built_on(processed_dir: Path) -> str | None:
    """When the snapshot was taken from FAO, as a timestamp."""
    day = _snapshot(processed_dir / "faostat" / "faostat.json").get("built_on")
    return f"{day}T00:00:00Z" if day else None


def currency(processed_dir: Path, m49: str | None) -> Currency | None:
    entry = _country(processed_dir, m49)
    return Currency(entry["currency_code"], entry["currency_name"]) if entry and entry.get("currency_code") else None


def income(processed_dir: Path, m49: str | None, fao_item: str, *, this_year: int) -> tuple[CountryIncome | None, str | None]:
    """The country's reported yield and price for one crop over its latest years, or the reason there is none."""
    entry = _country(processed_dir, m49)
    if entry is None:
        return None, "FAO holds no crop statistics for this country."
    item = entry["items"].get(fao_item)
    if item is None or not item["price_per_tonne"]:
        return None, f"{entry['name']} has reported no farm price for {fao_item.lower()} to FAO."
    newest = max(int(year) for year in item["price_per_tonne"])
    if newest < this_year - config.INCOME_PRICE_MAX_AGE_YEARS:
        return None, f"The last farm price {entry['name']} reported to FAO for {fao_item.lower()} is from {newest}, too old to put a money figure on."
    years = sorted(int(year) for year in set(item["price_per_tonne"]) & set(item["yield_t_per_ha"]))[-config.INCOME_RECENT_YEARS:]
    if len(years) < config.INCOME_MIN_YEARS:
        return None, f"{entry['name']} has reported too few years of both yield and price for {fao_item.lower()}."
    code = entry.get("currency_code") or "local currency"
    return CountryIncome(Reported({year: item["yield_t_per_ha"][str(year)] for year in years}, "t/ha", "country"),
                         Reported({year: item["price_per_tonne"][str(year)] for year in years}, f"{code}/t", "country"), years), None
