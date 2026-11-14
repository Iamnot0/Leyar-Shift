"""Ten-day weather outlook from the Meteomatics API. A forecast: never an input to the analysis."""

from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from app.adapters.base import Allowance, Fetcher, FetchError, SourceState

API = "https://api.meteomatics.com"
PARAMETERS = ("t_max_2m_24h:C", "t_min_2m_24h:C", "precip_24h:mm", "prob_precip_24h:p", "dew_point_mean_2m_24h:C",
              "wind_speed_mean_2m_24h:ms", "global_rad_24h:J")
REFRESH_DAYS = 0.125


@dataclass
class ForecastDay:
    day: date
    t_max_c: float
    t_min_c: float
    rain_mm: float
    rain_chance: float
    dew_point_c: float
    wind_2m_ms: float
    solar_mj: float


def _url(lon: float, lat: float, first: date, days: int) -> str:
    # Each value covers the 24 hours before its timestamp, so a local day is read at the next local midnight.
    to_utc = timedelta(hours=round(lon / 15.0))
    start = datetime.combine(first + timedelta(days=1), datetime.min.time()) - to_utc
    end = start + timedelta(days=days - 1)
    return f"{API}/{start:%Y-%m-%dT%H:%M:%SZ}--{end:%Y-%m-%dT%H:%M:%SZ}:P1D/{','.join(PARAMETERS)}/{lat:.5f},{lon:.5f}/json"


def outlook(fetcher: Fetcher, username: str | None, password: str | None, lon: float, lat: float, *, first: date, days: int,
            allowance: Allowance | None = None) -> tuple[list[ForecastDay], str | None, SourceState]:
    if not username or not password:
        return [], None, SourceState.not_configured("meteomatics")
    url = _url(lon, lat, first, days)
    credentials = base64.b64encode(f"{username}:{password}".encode()).decode()
    try:
        payload = fetcher.get_json("meteomatics", url, headers={"Authorization": f"Basic {credentials}"}, max_age_days=REFRESH_DAYS, timeout=60, attempts=2, allowance=allowance)
        columns = {block["parameter"]: [point["value"] for point in block["coordinates"][0]["dates"]] for block in payload["data"]}
        rows = list(zip(*(columns[name] for name in PARAMETERS), strict=True))
    except (FetchError, KeyError, IndexError, ValueError) as error:
        return [], None, SourceState.failed("meteomatics", error)
    if len(rows) != days or any(value is None for row in rows for value in row):
        return [], None, SourceState.failed("meteomatics", "the forecast came back incomplete")
    forecast = [ForecastDay(first + timedelta(days=index), float(high), float(low), max(float(rain), 0.0), min(max(float(chance) / 100.0, 0.0), 1.0),
                            float(dew), float(wind), float(solar) / 1e6) for index, (high, low, rain, chance, dew, wind, solar) in enumerate(rows)]
    return forecast, fetcher.fetched_at("meteomatics", "GET", url), SourceState.ok("meteomatics")
