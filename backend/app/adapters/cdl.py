"""USDA Cropland Data Layer: which crop class covered the field each year, and what the county grows.

Years held by Planetary Computer are read cell by cell. Later years come from the CropScape point
service, sampled across the field, because its clip service is too slow to depend on.
"""

from __future__ import annotations

import csv
import io
import re
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import rasterio
from rasterio.enums import Resampling

from app.adapters import raster
from app.adapters.base import Fetcher, FetchError, SourceState
from app.core import config
from app.fusion.grid import Grid

SERVICE = "https://nassgeodata.gmu.edu/axis2/services/CDLService"
RETURN_URL = re.compile(r"<returnURL>(.*?)</returnURL>")
POINT_VALUE = re.compile(r'value:\s*(\d+),\s*category:\s*"([^"]*)"')
POINT_SAMPLES = 25


def county_classes(fetcher: Fetcher, county_fips: str, year: int) -> dict[int, tuple[str, float]]:
    """Class code to (category name, acres) for one county and year."""

    def produce() -> dict[str, np.ndarray]:
        text = fetcher._fetch("GET", f"{SERVICE}/GetCDLStat", {"year": year, "fips": county_fips, "format": "csv"}, None, None, timeout=60, attempts=2)
        link = RETURN_URL.search(text.decode(errors="replace"))
        if not link:
            raise FetchError("county statistics returned no file link")
        content = fetcher._fetch("GET", link.group(1), None, None, None, timeout=60, attempts=2)
        rows = [row for row in csv.reader(io.StringIO(content.decode(errors="replace"))) if len(row) >= 4][1:]
        return {"codes": np.array([int(row[0]) for row in rows], dtype="int32"),
                "names": np.array([row[1].strip() for row in rows], dtype="U64"),
                "acres": np.array([float(row[3]) for row in rows], dtype="float64")}

    stored = fetcher.arrays("usda_cdl", ["county", county_fips, year], produce)
    return {int(code): (str(name), float(acres)) for code, name, acres in zip(stored["codes"], stored["names"], stored["acres"])}


def _shares(classes: np.ndarray) -> dict[int, float]:
    codes, counts = np.unique(classes, return_counts=True)
    return {int(code): float(count / classes.size) for code, count in zip(codes, counts)}


def _sample_cells(grid: Grid) -> list[tuple[float, float]]:
    rows, cols = np.nonzero(grid.mask)
    step = max(1, len(rows) // POINT_SAMPLES)
    t = grid.transform
    return [(t.c + (float(col) + 0.5) * t.a, t.f + (float(row) + 0.5) * t.e) for row, col in list(zip(rows, cols))[::step][:POINT_SAMPLES]]


def field_history(fetcher: Fetcher, grid: Grid) -> tuple[dict[int, dict[int, float]], dict[int, str], dict[int, int], SourceState]:
    """Per year: the share of the field under each class code. Also class names seen, and cells read per year."""
    years = list(range(config.CROP_HISTORY_FIRST_YEAR, config.CROP_HISTORY_LAST_YEAR + 1))
    history: dict[int, dict[int, float]] = {}
    names: dict[int, str] = {}
    cells_read: dict[int, int] = {}
    try:
        items = [item for item in raster._search(fetcher, "usda-cdl", grid, max_age_days=None) if item["properties"].get("usda_cdl:type") == "cropland"]
        token = raster._token(fetcher, "usda-cdl") if items else ""
    except FetchError:
        items, token = [], ""

    def from_archive(item: dict) -> tuple[int, np.ndarray | None]:
        year = int((item["properties"].get("start_datetime") or item["properties"]["datetime"])[:4])

        def produce() -> dict[str, np.ndarray]:
            return {"classes": raster._read_onto_grid(item["assets"]["cropland"]["href"] + "?" + token, grid, Resampling.nearest, dtype="int32")}

        try:
            return year, fetcher.arrays("usda_cdl", ["archive", item["id"], grid.signature()], produce)["classes"]
        except (FetchError, KeyError, rasterio.errors.RasterioError):
            return year, None

    with ThreadPoolExecutor(max_workers=6) as pool:
        for year, classes in pool.map(from_archive, items):
            if classes is not None and year in years and (classes[grid.mask] > 0).any():
                history[year] = _shares(classes[grid.mask])
                cells_read[year] = int(grid.n_cells)

    samples = _sample_cells(grid)

    def from_point(job: tuple[int, tuple[float, float]]) -> tuple[int, int | None, str | None]:
        year, (x, y) = job
        try:
            text = fetcher.request("usda_cdl", "GET", f"{SERVICE}/GetCDLValue", params={"year": year, "x": round(x, 1), "y": round(y, 1)},
                                   max_age_days=None, timeout=30, attempts=2).decode(errors="replace")
        except FetchError:
            return year, None, None
        match = POINT_VALUE.search(text)
        return (year, int(match.group(1)), match.group(2)) if match else (year, None, None)

    pending = [(year, sample) for year in years if year not in history for sample in samples]
    sampled: dict[int, list[int]] = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        for year, code, name in pool.map(from_point, pending):
            if code is not None:
                sampled.setdefault(year, []).append(code)
                names[code] = name or names.get(code, str(code))
    for year, codes in sampled.items():
        if len(codes) >= max(3, len(samples) // 2):
            history[year] = _shares(np.array(codes))
            cells_read[year] = len(codes)

    if not history:
        return {}, names, cells_read, SourceState.failed("usda_cdl", "no year of the crop map could be read")
    state = SourceState.ok("usda_cdl", period=(f"{min(history)}-01-01", f"{max(history)}-12-31"))
    missing = sorted(set(years) - set(history))
    if missing:
        state.message = f"The crop map could not be read for {len(missing)} of {len(years)} years."
    return history, names, cells_read, state
