"""Monthly point series from NASA's Giovanni time-series service: one request returns the whole record for one grid cell."""

from __future__ import annotations

from app.adapters.base import Fetcher, FetchError

API = "https://api.giovanni.earthdata.nasa.gov/timeseries"


class Series:
    """Values keyed YYYY-MM, in the unit Giovanni names, for the cell centred at (cell_lat, cell_lon)."""

    def __init__(self, values: dict[str, float], unit: str, cell_lat: float | None, cell_lon: float | None) -> None:
        self.values, self.unit, self.cell_lat, self.cell_lon = values, unit, cell_lat, cell_lon


def monthly(fetcher: Fetcher, source: str, token: str, variable: str, lon: float, lat: float, first_year: int, last_year: int,
            *, max_age_days: float = 30.0) -> Series:
    params = {"data": variable, "location": f"[{lat:.4f},{lon:.4f}]", "time": f"{first_year}-01-01T00:00:00/{last_year}-12-31T23:59:59"}
    text = fetcher.request(source, "GET", API, params=params, headers={"Authorization": f"Bearer {token}"}, max_age_days=max_age_days,
                           timeout=90, attempts=2).decode("utf-8", "replace")
    header: dict[str, str] = {}
    values: dict[str, float] = {}
    rows = False
    for line in text.splitlines():
        if not line.strip():
            continue
        if line.startswith("Timestamp"):
            rows = True
            continue
        key, _, value = line.partition(",")
        if not rows:
            header[key.strip()] = value.strip()
            continue
        try:
            number = float(value)
        except ValueError:
            continue
        if header.get("undef") and number == float(header["undef"]):
            continue
        values[key.strip()[:7]] = number
    if not rows:
        raise FetchError(f"Giovanni answered without a time series for {variable}")
    cell = lambda name: float(header[name]) if header.get(name) not in (None, "") else None
    return Series(values, header.get("unit", ""), cell("lat"), cell("lon"))
