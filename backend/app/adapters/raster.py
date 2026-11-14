"""Raster sources read from Microsoft Planetary Computer onto the analysis grid.

Every read is cached as arrays, so a replayed run needs neither the network nor the remote file.
"""

from __future__ import annotations

import io
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import from_bounds
from shapely.geometry import mapping

from app.adapters.base import Fetcher, FetchError, SourceState
from app.core import config
from app.fusion.grid import Grid

STAC_SEARCH = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
SAS_TOKEN = "https://planetarycomputer.microsoft.com/api/sas/v1/token/"
CROP_API = "https://planetarycomputer.microsoft.com/api/data/v1/item/bbox"
# One request per picture, so these are bound by round trips and not by this machine.
CROP_WORKERS = 32
GDAL_ENV = {"GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR", "GDAL_HTTP_MAX_RETRY": "4", "GDAL_HTTP_RETRY_DELAY": "1",
            "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif,.tiff", "GDAL_HTTP_TIMEOUT": "60"}
# Sentinel-2 scene classes that show the ground: vegetation, bare soil, unclassified.
CLEAR_SCL = (4, 5, 7)
# Reflectance carries a +1000 offset from processing baseline 04.00 on.
S2_OFFSET_FROM_BASELINE = 4.0
SCENE_MIN_CLEAR_SHARE = 0.7
SCENE_MAX_CLOUD_PERCENT = 80
MODIS_FIRST_YEAR = 2001
MODIS_NDVI_SCALE = 0.0001
# MODIS pixel reliability: 0 good, 1 marginal. Snow, cloud and fill are left out.
MODIS_MAX_RELIABILITY = 1
_SCENE_LOCK = threading.Lock()
_SCENE_CACHE: dict[tuple[str, str, str, str, str], NdviScene | None] = {}


@dataclass
class NdviScene:
    day: date
    ndvi: float
    clear_share: float


def _cached_scene(fetcher: Fetcher, source: str, item_id: str, grid: Grid, compute) -> NdviScene | None:
    key = (str(fetcher.cache_dir), fetcher.mode, source, item_id, repr(grid.signature()))
    with _SCENE_LOCK:
        if key in _SCENE_CACHE:
            return _SCENE_CACHE[key]
    value = compute()
    with _SCENE_LOCK:
        if len(_SCENE_CACHE) >= 8192:
            _SCENE_CACHE.clear()
        _SCENE_CACHE[key] = value
    return value


def _token(fetcher: Fetcher, collection: str) -> str:
    # Tokens last about an hour; a 30 minute cache keeps them fresh without asking per read.
    return fetcher.get_json("planetary_computer", SAS_TOKEN + collection, max_age_days=0.02)["token"]


def _crop(fetcher: Fetcher, collection: str, item_id: str, assets: tuple[str, ...], grid: Grid, resampling: str) -> np.ndarray:
    """The named bands of one picture, cut and resampled onto the grid by the catalogue's own server, which sits beside the files.

    Returns (band, row, column) with NaN where the picture holds no data. Reading the files from here instead costs
    several slow round trips for each band.
    """
    west, south, east, north = grid.bounds_xy
    rows, cols = grid.shape
    params = {"collection": collection, "item": item_id, "assets": list(assets), "coord_crs": grid.crs.lower(), "dst_crs": grid.crs.lower(),
              "resampling": resampling}
    content = fetcher.download(f"{CROP_API}/{west},{south},{east},{north}/{cols}x{rows}.npy", params=params, timeout=60)
    data = np.load(io.BytesIO(content), allow_pickle=False)
    if data.shape != (len(assets) + 1, rows, cols):
        raise FetchError(f"the crop of {item_id} came back as {data.shape}")
    values = data[:-1].astype("float32")
    # The last band is the server's own mask of where the picture has data.
    values[:, data[-1] == 0] = np.nan
    return values


def _search(fetcher: Fetcher, collection: str, grid: Grid, *, max_age_days: float | None, **extra: object) -> list[dict]:
    body = {"collections": [collection], "intersects": mapping(grid.polygon_lonlat.centroid), "limit": 250, **extra}
    items: list[dict] = []
    token = None
    for _ in range(12):
        page = dict(body, token=token) if token else body
        payload = fetcher.post_json("planetary_computer", STAC_SEARCH, json_body=page, max_age_days=max_age_days)
        items.extend(payload.get("features", []))
        following = next((link for link in payload.get("links", []) if link.get("rel") == "next"), None)
        token = (following or {}).get("body", {}).get("token")
        if not token:
            break
    return items


def _read_onto_grid(href: str, grid: Grid, resampling: Resampling, *, dtype: str = "float32") -> np.ndarray:
    """Read only the window over the field, then resample that window onto the grid."""
    with rasterio.Env(**GDAL_ENV), rasterio.open(href) as source:
        bounds = transform_bounds(grid.crs, source.crs, *grid.bounds_xy, densify_pts=21)
        pad = 4 * max(abs(source.res[0]), abs(source.res[1]))
        window = from_bounds(bounds[0] - pad, bounds[1] - pad, bounds[2] + pad, bounds[3] + pad, source.transform)
        window = window.round_offsets().round_lengths()
        data = source.read(1, window=window, boundless=True, fill_value=source.nodata if source.nodata is not None else 0)
        target = np.full(grid.shape, np.nan if dtype.startswith("float") else 0, dtype=dtype)
        reproject(data, target, src_transform=source.window_transform(window), src_crs=source.crs, src_nodata=source.nodata,
                  dst_transform=grid.transform, dst_crs=grid.crs, dst_nodata=np.nan if dtype.startswith("float") else 0,
                  resampling=resampling)
    return target


def elevation(fetcher: Fetcher, grid: Grid) -> tuple[np.ndarray | None, SourceState]:
    try:
        items = _search(fetcher, "nasadem", grid, max_age_days=None)
        if not items:
            return None, SourceState.out_of_coverage("nasadem", "NASADEM has no elevation tile for this location.")
        item = items[0]

        def produce() -> dict[str, np.ndarray]:
            href = item["assets"]["elevation"]["href"] + "?" + _token(fetcher, "nasadem")
            return {"elevation": _read_onto_grid(href, grid, Resampling.bilinear)}

        data = fetcher.arrays("nasadem", [item["id"], grid.signature()], produce)["elevation"]
    except (FetchError, KeyError, rasterio.errors.RasterioError) as error:
        return None, SourceState.failed("nasadem", error)
    return data, SourceState.ok("nasadem", period=("2000-02-11", "2000-02-22"))


def soil_map_units(fetcher: Fetcher, grid: Grid) -> np.ndarray | None:
    """Soil survey map-unit key per grid cell, from the gridded national soil survey. US only."""
    try:
        items = _search(fetcher, "gnatsgo-rasters", grid, max_age_days=None)
        if not items:
            return None
        item = items[0]

        def produce() -> dict[str, np.ndarray]:
            href = item["assets"]["mukey"]["href"] + "?" + _token(fetcher, "gnatsgo-rasters")
            return {"mukey": _read_onto_grid(href, grid, Resampling.mode, dtype="int32")}

        return fetcher.arrays("ssurgo", [item["id"], "mukey", grid.signature()], produce)["mukey"]
    except (FetchError, KeyError, rasterio.errors.RasterioError):
        return None


def _scene(fetcher: Fetcher, item: dict, grid: Grid) -> NdviScene | None:
    def produce() -> dict[str, np.ndarray]:
        red, nir = _crop(fetcher, "sentinel-2-l2a", item["id"], ("B04", "B08"), grid, "average")
        return {"B04": red, "B08": nir, "SCL": _crop(fetcher, "sentinel-2-l2a", item["id"], ("SCL",), grid, "mode")[0]}

    def compute() -> NdviScene | None:
        try:
            bands = fetcher.arrays("sentinel2", [item["id"], grid.signature()], produce)
        except (FetchError, KeyError, rasterio.errors.RasterioError):
            return None
        offset = 1000.0 if float(item["properties"].get("s2:processing_baseline", "0") or 0) >= S2_OFFSET_FROM_BASELINE else 0.0
        red, nir = bands["B04"] - offset, bands["B08"] - offset
        clear = np.isin(np.nan_to_num(bands["SCL"], nan=0).astype(int), CLEAR_SCL) & grid.mask & np.isfinite(red) & np.isfinite(nir) & ((red + nir) > 0)
        share = float(clear.sum() / max(grid.n_cells, 1))
        if share < SCENE_MIN_CLEAR_SHARE:
            return None
        ndvi = (nir[clear] - red[clear]) / (nir[clear] + red[clear])
        return NdviScene(date.fromisoformat(item["properties"]["datetime"][:10]), float(np.mean(ndvi)), share)

    return _cached_scene(fetcher, "sentinel2", item["id"], grid, compute)


def ndvi_scenes(fetcher: Fetcher, grid: Grid, *, today: date) -> tuple[list[NdviScene], list[date], SourceState]:
    """Field-mean greenness for every clear Sentinel-2 pass, and the day of every pass, clear or not."""
    start = f"{config.VEGETATION_FIRST_YEAR}-01-01"
    try:
        items = _search(fetcher, "sentinel-2-l2a", grid, max_age_days=1.0, datetime=f"{start}T00:00:00Z/{today.isoformat()}T23:59:59Z")
    except FetchError as error:
        return [], [], SourceState.failed("sentinel2", error)
    by_day: dict[str, dict] = {}
    for item in items:
        day = item["properties"]["datetime"][:10]
        best = by_day.get(day)
        if best is None or item["properties"].get("eo:cloud_cover", 100) < best["properties"].get("eo:cloud_cover", 100):
            by_day[day] = item
    passes = sorted(date.fromisoformat(day) for day in by_day)
    if not passes:
        return [], [], SourceState.out_of_coverage("sentinel2", "No Sentinel-2 pictures cover this field.")
    candidates = [item for item in by_day.values() if item["properties"].get("eo:cloud_cover", 100) <= SCENE_MAX_CLOUD_PERCENT]
    with ThreadPoolExecutor(max_workers=CROP_WORKERS) as pool:
        scenes = [scene for scene in pool.map(lambda item: _scene(fetcher, item, grid), candidates) if scene is not None]
    scenes.sort(key=lambda scene: scene.day)
    state = SourceState.ok("sentinel2", period=(start, today.isoformat()))
    return scenes, passes, state


def _composite(fetcher: Fetcher, item: dict, grid: Grid) -> NdviScene | None:
    def produce() -> dict[str, np.ndarray]:
        greenness, reliability = _crop(fetcher, "modis-13Q1-061", item["id"], ("250m_16_days_NDVI", "250m_16_days_pixel_reliability"), grid, "nearest")
        return {"NDVI": greenness, "pixel_reliability": reliability}

    def compute() -> NdviScene | None:
        try:
            bands = fetcher.arrays("modis_vegetation", [item["id"], grid.signature()], produce)
        except (FetchError, KeyError, rasterio.errors.RasterioError):
            return None
        usable = grid.mask & np.isfinite(bands["NDVI"]) & (bands["pixel_reliability"] >= 0) & (bands["pixel_reliability"] <= MODIS_MAX_RELIABILITY)
        if not usable.any():
            return None
        day = date.fromisoformat(item["properties"]["start_datetime"][:10])
        return NdviScene(day, float(np.mean(bands["NDVI"][usable]) * MODIS_NDVI_SCALE), float(usable.sum() / max(grid.n_cells, 1)))

    return _cached_scene(fetcher, "modis_vegetation", item["id"], grid, compute)


def greenness_history(fetcher: Fetcher, grid: Grid, *, today: date) -> tuple[list[NdviScene], SourceState]:
    """Field greenness every 16 days since 2001 from MODIS on the Terra satellite, in 250 m pixels."""
    start, end = f"{MODIS_FIRST_YEAR}-01-01", today.isoformat()
    try:
        items = _search(fetcher, "modis-13Q1-061", grid, max_age_days=7.0, datetime=f"{start}T00:00:00Z/{end}T23:59:59Z")
        items = [item for item in items if item["id"].startswith("MOD13Q1") and item["properties"]["start_datetime"][:4] >= str(MODIS_FIRST_YEAR)]
        if not items:
            return [], SourceState.out_of_coverage("modis_vegetation", "No MODIS vegetation record covers this field.")
    except (FetchError, KeyError) as error:
        return [], SourceState.failed("modis_vegetation", error)
    with ThreadPoolExecutor(max_workers=CROP_WORKERS) as pool:
        composites = [scene for scene in pool.map(lambda item: _composite(fetcher, item, grid), items) if scene is not None]
    if not composites:
        return [], SourceState.failed("modis_vegetation", "no composite could be read")
    composites.sort(key=lambda scene: scene.day)
    return composites, SourceState.ok("modis_vegetation", period=(start, composites[-1].day.isoformat()))

