"""Monthly field water use from OpenET, which works it out from Landsat pictures. United States only."""

from __future__ import annotations

from datetime import date

from app.adapters.base import Allowance, Fetcher, FetchError, SourceState
from app.fusion.grid import Grid

API = "https://openet-api.org/raster/timeseries/polygon"
FIRST_YEAR = 2016
MAX_VERTICES = 40
SIMPLIFY_DEGREES = 0.00005


def _ring(grid: Grid) -> list[float]:
    """The field outline as OpenET wants it: one closed ring, flat, longitude then latitude."""
    shape = grid.polygon_lonlat
    outline = max(shape.geoms, key=lambda part: part.area) if shape.geom_type == "MultiPolygon" else shape
    points = list(outline.exterior.simplify(SIMPLIFY_DEGREES).coords)
    step = max(1, -(-(len(points) - 1) // MAX_VERTICES))
    kept = points[:-1][::step]
    return [round(value, 5) for lon, lat, *_ in kept + [kept[0]] for value in (lon, lat)]


def monthly_water_use(fetcher: Fetcher, key: str | None, grid: Grid, *, today: date, allowance: Allowance | None = None) -> tuple[dict[str, float], SourceState]:
    """Millimetres of water leaving the field in each month, keyed YYYY-MM, for every full year on record."""
    if not key:
        return {}, SourceState.not_configured("openet")
    period = (f"{FIRST_YEAR}-01-01", f"{today.year - 1}-12-31")
    body = {"date_range": list(period), "interval": "monthly", "geometry": _ring(grid), "model": "Ensemble", "variable": "ET",
            "reference_et": "gridMET", "units": "mm", "reducer": "mean", "file_format": "JSON"}
    try:
        # The account allows 100 requests a month, and past months do not change: one request per field, kept for good.
        rows = fetcher.post_json("openet", API, json_body=body, headers={"Authorization": key}, max_age_days=None, timeout=170, attempts=2, allowance=allowance)
        months = {row["time"][:7]: float(row["et"]) for row in rows if row.get("et") is not None}
    except (FetchError, KeyError, TypeError, ValueError) as error:
        return {}, SourceState.failed("openet", error)
    if len(months) < 12:
        return {}, SourceState.insufficient("openet", "OpenET returned less than a year of readings for this field.")
    return months, SourceState.ok("openet", period=period)
