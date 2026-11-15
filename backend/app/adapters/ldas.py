"""Water in the soil from NASA's land models, GLDAS worldwide and NLDAS over North America, month by month since 2001."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import numpy as np

from app.adapters import giovanni
from app.adapters.base import Fetcher, FetchError, SourceState
from app.core import config

MODELS = {
    "gldas": ("GLDAS_NOAH025_M_2_1_RootMoist_inst", "the root zone"),
    "nldas": ("NLDAS_NOAH0125_M_2_0_SoilM_0_100cm", "the top metre"),
}


@dataclass
class SoilWater:
    """The latest month's soil water against the same month in other years, in millimetres of water (kg per square metre)."""

    source: str
    layer: str
    month: str
    latest: float
    usual: float
    low: float
    high: float
    years: int
    first_year: int


def soil_water(fetcher: Fetcher, token: str | None, source: str, lon: float, lat: float, *, today: date) -> tuple[SoilWater | None, SourceState]:
    if not token:
        return None, SourceState.not_configured(source)
    variable, layer = MODELS[source]
    try:
        series = giovanni.monthly(fetcher, source, token, variable, lon, lat, config.BASELINE_FIRST_YEAR, today.year, max_age_days=7.0)
    except FetchError as error:
        return None, SourceState.failed(source, error)
    if not series.values:
        return None, SourceState.out_of_coverage(source, f"{source.upper()} has no soil water for this location.")
    month = max(series.values)
    same_month = [value for key, value in series.values.items() if key[5:] == month[5:] and key != month]
    if len(same_month) < 5:
        return None, SourceState.insufficient(source, f"Only {len(same_month)} earlier years of {source.upper()} for this month.")
    found = SoilWater(source, layer, month, series.values[month], float(np.median(same_month)), float(np.percentile(same_month, 10)),
                      float(np.percentile(same_month, 90)), len(same_month), int(min(series.values)[:4]))
    return found, SourceState.ok(source, period=(f"{min(series.values)}-01", f"{month}-28"))
