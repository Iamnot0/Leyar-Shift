"""Change in all the water stored under a region, from NASA's GRACE and GRACE-FO satellites (JPL mascons, RL06.3, version 4).

The whole record is one global file of about 46 MB. It is fetched once per server and kept on its disk; each field then
reads the monthly series for its own 0.5 degree cell, which sits inside a mascon about 300 km across.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import rasterio

from app.adapters.base import Fetcher, FetchError, SourceState
from app.adapters.groundwater import theil_sen

COLLECTION = "TELLUS_GRAC-GRFO_MASCON_CRI_GRID_RL06.3_V4"
CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"
EPOCH = date(2002, 1, 1)
_LOCK = threading.Lock()


@dataclass
class StorageTrend:
    """Centimetres of water a year, positive when storage is rising."""

    slope: float
    low: float
    high: float
    first: date
    last: date
    months: int


def _granule(fetcher: Fetcher) -> tuple[str, str]:
    found = fetcher.get_json("grace_fo", CMR, params={"short_name": COLLECTION, "sort_key": "-start_date", "page_size": 1}, max_age_days=7.0)
    entry = found["feed"]["entry"][0]
    url = next(link["href"] for link in entry["links"] if link["href"].startswith("https://") and link["href"].endswith(".nc"))
    return entry["title"], url


def _local_copy(fetcher: Fetcher, token: str, name: str, url: str) -> Path:
    path = fetcher.cache_dir.parent / "grace" / f"{name}.nc"
    with _LOCK:
        if not path.exists():
            content = fetcher._fetch("GET", url, None, None, {"Authorization": f"Bearer {token}"}, timeout=180, attempts=2)
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(".part")
            temporary.write_bytes(content)
            temporary.replace(path)
    return path


def storage_trend(fetcher: Fetcher, token: str | None, lon: float, lat: float) -> tuple[StorageTrend | None, SourceState]:
    if not token:
        return None, SourceState.not_configured("grace_fo")
    try:
        name, url = _granule(fetcher)

        def produce() -> dict[str, np.ndarray]:
            with rasterio.open(f'NETCDF:"{_local_copy(fetcher, token, name, url)}":lwe_thickness') as source:
                row, col = source.index(lon % 360.0, lat)
                values = source.read(window=((row, row + 1), (col, col + 1)))[:, 0, 0].astype("float64")
                days = np.array([float(day) for day in source.tags()["NETCDF_DIM_time_VALUES"].strip("{}").split(",")])
            return {"days": days, "cm": values}

        series = fetcher.arrays("grace_fo", [name, round(lon, 2), round(lat, 2)], produce)
    except (FetchError, KeyError, StopIteration, rasterio.errors.RasterioError) as error:
        return None, SourceState.failed("grace_fo", error if isinstance(error, FetchError) else FetchError(str(error)))
    days, cm = series["days"], series["cm"]
    keep = np.isfinite(cm)
    if keep.sum() < 60:
        return None, SourceState.insufficient("grace_fo", "GRACE has too few months for this location; it reads land only.")
    years, values = days[keep] / 365.25, cm[keep]
    slope = theil_sen(years, values)
    # The spread is the trend's standard error, from what is left once the trend is taken out.
    residual = values - (values.mean() + slope * (years - years.mean()))
    spread = 1.28 * float(np.sqrt(np.sum(residual ** 2) / (len(years) - 2) / np.sum((years - years.mean()) ** 2)))
    first, last = EPOCH + timedelta(days=float(days[keep][0])), EPOCH + timedelta(days=float(days[keep][-1]))
    trend = StorageTrend(slope, slope - spread, slope + spread, first, last, int(keep.sum()))
    return trend, SourceState.ok("grace_fo", period=(first.isoformat(), last.isoformat()))
