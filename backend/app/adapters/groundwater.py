"""USGS groundwater levels near a field: the ground-side check on satellite water-storage trends."""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime

import numpy as np

from app.adapters.base import Fetcher, FetchError, SourceState
from app.core import config

ITEMS_URL = "https://api.waterdata.usgs.gov/ogcapi/v0/collections/field-measurements/items"
DEPTH_TO_WATER = "72019"
WINTER_MONTHS = (12, 1, 2, 3)


@dataclass
class WellTrend:
    """Change in depth to water across nearby wells. A positive slope means the water table is falling."""

    median_slope: float
    low_slope: float
    high_slope: float
    unit: str
    n_wells: int
    n_measurements: int
    falling_share: float
    first_year: int
    last_year: int
    nearest_km: float


def theil_sen(x: np.ndarray, y: np.ndarray) -> float:
    i, j = np.triu_indices(len(x), 1)
    spans = x[j] - x[i]
    keep = spans != 0
    return float(np.median((y[j] - y[i])[keep] / spans[keep]))


def _distance_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    dx = math.radians(lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2))
    dy = math.radians(lat2 - lat1)
    return 6371.0 * math.hypot(dx, dy)


def fetch_well_trend(fetcher: Fetcher, lon: float, lat: float, *, since: int = 0) -> tuple[WellTrend | None, SourceState]:
    radius = config.WELL_SEARCH_RADIUS_KM
    dlat = radius / 111.0
    dlon = radius / (111.0 * math.cos(math.radians(lat)))
    params = {"f": "json", "bbox": f"{lon - dlon:.4f},{lat - dlat:.4f},{lon + dlon:.4f},{lat + dlat:.4f}", "parameter_code": DEPTH_TO_WATER,
              "limit": 10000, "properties": "monitoring_location_id,time,value,unit_of_measure"}
    try:
        features: list[dict] = []
        payload = fetcher.get_json("usgs_groundwater", ITEMS_URL, params=params, max_age_days=30)
        for _ in range(20):
            features.extend(payload.get("features", []))
            following = next((link["href"] for link in payload.get("links", []) if link.get("rel") == "next"), None)
            if not following:
                break
            payload = fetcher.get_json("usgs_groundwater", following, max_age_days=30)
    except (FetchError, KeyError) as error:
        return None, SourceState.failed("usgs_groundwater", error)

    wells: dict[str, dict] = defaultdict(lambda: {"by_year": {}, "distance": None, "unit": None, "count": 0})
    for feature in features:
        properties = feature.get("properties", {})
        coordinates = (feature.get("geometry") or {}).get("coordinates")
        try:
            when = datetime.fromisoformat(properties["time"].replace("Z", "+00:00"))
            depth = float(properties["value"])
        except (KeyError, TypeError, ValueError):
            continue
        well = wells[properties.get("monitoring_location_id", "")]
        well["count"] += 1
        well["unit"] = properties.get("unit_of_measure")
        if coordinates and well["distance"] is None:
            well["distance"] = _distance_km(lon, lat, coordinates[0], coordinates[1])
        # One winter reading a year keeps pumping-season drawdown out of the trend.
        if when.month in WINTER_MONTHS:
            season = when.year + (1 if when.month == 12 else 0)
            well["by_year"].setdefault(season, []).append(depth)

    slopes, first_years, last_years, distances, units, used = [], [], [], [], set(), 0
    for well in wells.values():
        if well["distance"] is not None and well["distance"] > radius:
            continue
        years = sorted(year for year in well["by_year"] if year >= since)
        if len(years) < config.WELL_MIN_YEARS:
            continue
        x = np.array(years, dtype=float)
        y = np.array([float(np.mean(well["by_year"][year])) for year in years])
        slopes.append(theil_sen(x, y))
        first_years.append(years[0])
        last_years.append(years[-1])
        used += sum(len(well["by_year"][year]) for year in years)
        units.add(well["unit"])
        if well["distance"] is not None:
            distances.append(well["distance"])
    if not slopes:
        if not features:
            return None, SourceState.out_of_coverage("usgs_groundwater", f"No USGS well with depth-to-water readings lies within {radius:.0f} km of this field.")
        return None, SourceState.insufficient("usgs_groundwater", f"No well within {radius:.0f} km has {config.WELL_MIN_YEARS} or more winters of readings.")
    values = np.array(slopes)
    unit = next(iter(units)) if len(units) == 1 else "ft"
    trend = WellTrend(median_slope=float(np.median(values)), low_slope=float(np.percentile(values, 10)), high_slope=float(np.percentile(values, 90)),
                      unit=f"{unit}/yr", n_wells=len(slopes), n_measurements=used, falling_share=float((values > 0).mean()),
                      first_year=min(first_years), last_year=max(last_years), nearest_km=min(distances) if distances else float("nan"))
    state = SourceState.ok("usgs_groundwater", period=(f"{trend.first_year}-01-01", f"{trend.last_year}-12-31"))
    return trend, state
