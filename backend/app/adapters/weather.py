"""Daily weather: NASA POWER as the primary record, ERA5 (through Open-Meteo) as a second rainfall source."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import numpy as np

from app.adapters.base import Fetcher, FetchError, SourceState
from app.core import config

POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
POWER_PARAMETERS = ("T2M_MAX", "T2M_MIN", "T2MDEW", "WS2M", "ALLSKY_SFC_SW_DWN", "PRECTOTCORR", "GWETROOT")
OPEN_METEO_URL = "https://archive-api.open-meteo.com/v1/archive"
POWER_CELL_DEG = (0.625, 0.5)
ERA5_CELL_DEG = (0.25, 0.25)
POWER_FILL = -900.0


@dataclass
class WeatherRecord:
    """Daily series on one shared calendar. Missing days are NaN."""

    dates: np.ndarray
    tmax: np.ndarray
    tmin: np.ndarray
    tdew: np.ndarray
    wind: np.ndarray
    srad: np.ndarray
    rain: np.ndarray
    wetness: np.ndarray
    latitude: float
    elevation: float
    rain_alt: np.ndarray | None = None

    @property
    def years(self) -> np.ndarray:
        return self.dates.astype("datetime64[Y]").astype(int) + 1970

    @property
    def day_of_year(self) -> np.ndarray:
        return (self.dates - self.dates.astype("datetime64[Y]")).astype(int) + 1

    @property
    def months(self) -> np.ndarray:
        return self.dates.astype("datetime64[M]").astype(int) % 12 + 1


def cell_footprint(lon: float, lat: float, cell_deg: tuple[float, float], origin_lon: float = -180.0) -> dict:
    """The grid cell whose centre is nearest the point, as a GeoJSON polygon."""
    width, height = cell_deg
    centre_lon = round((lon - origin_lon) / width) * width + origin_lon
    centre_lat = round(lat / height) * height
    west, east = centre_lon - width / 2, centre_lon + width / 2
    south, north = max(centre_lat - height / 2, -90.0), min(centre_lat + height / 2, 90.0)
    ring = [[west, south], [east, south], [east, north], [west, north], [west, south]]
    return {"type": "Polygon", "coordinates": [[[round(x, 5), round(y, 5)] for x, y in ring]]}


def _period() -> tuple[str, str]:
    return f"{config.BASELINE_FIRST_YEAR}-01-01", f"{config.BASELINE_LAST_YEAR}-12-31"


def fetch_power(fetcher: Fetcher, lon: float, lat: float) -> tuple[WeatherRecord | None, SourceState]:
    start, end = _period()
    params = {"parameters": ",".join(POWER_PARAMETERS), "community": "AG", "longitude": round(lon, 4), "latitude": round(lat, 4),
              "start": start.replace("-", ""), "end": end.replace("-", ""), "format": "JSON"}
    try:
        payload = fetcher.get_json("nasa_power", POWER_URL, params=params, max_age_days=None)
        series = payload["properties"]["parameter"]
        days = sorted(series["T2M_MAX"])
        dates = np.array([f"{d[:4]}-{d[4:6]}-{d[6:]}" for d in days], dtype="datetime64[D]")

        def column(name: str) -> np.ndarray:
            values = np.array([series[name][d] for d in days], dtype=float)
            values[values < POWER_FILL] = np.nan
            return values

        record = WeatherRecord(dates=dates, tmax=column("T2M_MAX"), tmin=column("T2M_MIN"), tdew=column("T2MDEW"), wind=column("WS2M"),
                               srad=column("ALLSKY_SFC_SW_DWN"), rain=column("PRECTOTCORR"), wetness=column("GWETROOT"),
                               latitude=lat, elevation=float(payload["geometry"]["coordinates"][2]))
    except (FetchError, KeyError, ValueError, IndexError) as error:
        return None, SourceState.failed("nasa_power", error)
    if np.isnan(record.tmax).mean() > 0.2 or np.isnan(record.rain).mean() > 0.2:
        return None, SourceState.insufficient("nasa_power", "NASA POWER has too many missing days here to build a weather record.")
    state = SourceState.ok("nasa_power", as_of=fetcher.fetched_at("nasa_power", "GET", POWER_URL, params=params), period=(start, end),
                           footprint=cell_footprint(lon, lat, POWER_CELL_DEG))
    return record, state


@dataclass
class RecentRecord:
    """Rain and soil wetness, day by day from 2001 to the latest day the record holds."""

    dates: np.ndarray
    rain: np.ndarray
    wetness_surface: np.ndarray
    wetness_root: np.ndarray


def fetch_recent(fetcher: Fetcher, lon: float, lat: float, *, today: date) -> tuple[RecentRecord | None, SourceState]:
    params = {"parameters": "PRECTOTCORR,GWETTOP,GWETROOT", "community": "AG", "longitude": round(lon, 4), "latitude": round(lat, 4),
              "start": f"{config.BASELINE_FIRST_YEAR}0101", "end": today.strftime("%Y%m%d"), "format": "JSON"}
    try:
        series = fetcher.get_json("nasa_power", POWER_URL, params=params, max_age_days=0.25)["properties"]["parameter"]
        days = sorted(series["PRECTOTCORR"])

        def column(name: str) -> np.ndarray:
            values = np.array([series[name][d] for d in days], dtype=float)
            values[values < POWER_FILL] = np.nan
            return values

        record = RecentRecord(np.array([f"{d[:4]}-{d[4:6]}-{d[6:]}" for d in days], dtype="datetime64[D]"), column("PRECTOTCORR"), column("GWETTOP"), column("GWETROOT"))
    except (FetchError, KeyError, ValueError) as error:
        return None, SourceState.failed("nasa_power", error)
    return record, SourceState.ok("nasa_power")


def fetch_era5_rain(fetcher: Fetcher, lon: float, lat: float, dates: np.ndarray) -> tuple[np.ndarray | None, SourceState]:
    start, end = _period()
    params = {"latitude": round(lat, 4), "longitude": round(lon, 4), "start_date": start, "end_date": end,
              "daily": "precipitation_sum", "models": "era5", "timezone": "UTC"}
    try:
        payload = fetcher.get_json("era5_open_meteo", OPEN_METEO_URL, params=params, max_age_days=None)
        got = np.array(payload["daily"]["time"], dtype="datetime64[D]")
        values = np.array([np.nan if v is None else v for v in payload["daily"]["precipitation_sum"]], dtype=float)
    except (FetchError, KeyError, ValueError) as error:
        return None, SourceState.failed("era5_open_meteo", error)
    aligned = np.full(dates.shape, np.nan)
    position = {d: i for i, d in enumerate(got)}
    for i, day in enumerate(dates):
        j = position.get(day)
        if j is not None:
            aligned[i] = values[j]
    if np.isnan(aligned).mean() > 0.2:
        return None, SourceState.insufficient("era5_open_meteo", "ERA5 has too many missing days here to use as a second rainfall record.")
    state = SourceState.ok("era5_open_meteo", as_of=fetcher.fetched_at("era5_open_meteo", "GET", OPEN_METEO_URL, params=params),
                           period=(start, end), footprint=cell_footprint(payload["longitude"], payload["latitude"], ERA5_CELL_DEG, origin_lon=0.0))
    return aligned, state
