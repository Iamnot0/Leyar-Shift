"""NASA GIBS imagery layers for map context. Only layers found in the live capabilities document are offered."""

from __future__ import annotations

import math
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from xml.etree.ElementTree import ParseError

from defusedxml import ElementTree

from app.adapters.base import Fetcher, FetchError

CAPABILITIES = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml"
TILES = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best"
NAMESPACES = {"wmts": "http://www.opengis.net/wmts/1.0", "ows": "http://www.opengis.net/ows/1.1"}
XLINK_HREF = "{http://www.w3.org/1999/xlink}href"
# Layer id, product shown, plain title, ground size in metres.
WANTED = (
    ("Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual", "landsat_weld", "Cloud-free satellite picture from the year 2000, 30 m, for orientation only", 30.0),
    ("HLS_S30_Nadir_BRDF_Adjusted_Reflectance", "hls_s30", "Recent satellite picture, 30 m (Sentinel-2)", 30.0),
    ("HLS_L30_Nadir_BRDF_Adjusted_Reflectance", "hls_l30", "Recent satellite picture, 30 m (Landsat)", 30.0),
    ("MODIS_Terra_CorrectedReflectance_TrueColor", "modis_terra", "Daily satellite picture, 250 m (MODIS)", 250.0),
    ("SMAP_L4_Analyzed_Root_Zone_Soil_Moisture", "smap_l4", "Root-zone soil moisture, 9 km (SMAP)", 9000.0),
    ("IMERG_Precipitation_Rate", "gpm_imerg", "Rainfall rate, about 10 km (IMERG)", 10000.0),
)
EXTENSIONS = {"image/png": "png", "image/jpeg": "jpeg"}
# The 30 m daily layers are only filled where a satellite passed, so the newest filled day is searched for per location.
SEARCH_BACK_DAYS = 16
EMPTY_TILE_BYTES = 2000


_CAP_LOCK = threading.Lock()
_CAP_CACHE: dict[tuple[int, bytes, bytes], list[dict]] = {}


def tile_xy(lon: float, lat: float, zoom: int) -> tuple[int, int]:
    n = 2**zoom
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)
    return min(max(x, 0), n - 1), min(max(y, 0), n - 1)


def _filled_day(fetcher: Fetcher, layer: dict, lon: float, lat: float) -> str | None:
    """The newest day on which the layer shows something at this place, or None."""
    zoom = min(layer["max_zoom"], 9)
    x, y = tile_xy(lon, lat, zoom)
    newest = date.fromisoformat(layer["time"]["default"])
    sharp = layer["native_resolution_m"] <= 30
    if layer["time"]["step"] != "day":
        days = [newest]
    elif sharp:
        days = [newest - timedelta(days=back) for back in range(SEARCH_BACK_DAYS)]
    else:
        # Today's global mosaics are still being filled, so coarse layers start from yesterday.
        days = [newest - timedelta(days=back) for back in (1, 2, 3)]
    for day in days:
        url = layer["url_template"].replace("{time}", day.isoformat()).replace("{z}", str(zoom)).replace("{y}", str(y)).replace("{x}", str(x))
        try:
            content = fetcher.request("gibs", "GET", url, max_age_days=30, timeout=30, attempts=1)
        except FetchError:
            continue
        # A coarse global layer can be rightly blank here, for example no rain; only sharp layers must show ground.
        if not sharp or len(content) > EMPTY_TILE_BYTES:
            return day.isoformat()
    return None


def layers_at(fetcher: Fetcher, lon: float, lat: float) -> list[dict]:
    """Layers that return a real tile at this location, each with a default day that has data there."""
    layers = context_layers(fetcher)
    if not layers:
        return []
    with ThreadPoolExecutor(max_workers=len(layers)) as pool:
        days = list(pool.map(lambda layer: _filled_day(fetcher, layer, lon, lat), layers))
    return [{**layer, "time": {**layer["time"], "default": day}} for layer, day in zip(layers, days) if day is not None]


def context_layers(fetcher: Fetcher) -> list[dict]:
    try:
        raw = fetcher.request("gibs", "GET", CAPABILITIES, max_age_days=7, timeout=120)
    except FetchError:
        return []
    sig = (len(raw), raw[:128], raw[-128:])
    with _CAP_LOCK:
        cached = _CAP_CACHE.get(sig)
    if cached is not None:
        return cached
    try:
        root = ElementTree.fromstring(raw)
    except ParseError:
        return []
    found = {}
    for layer in root.iterfind(".//wmts:Layer", NAMESPACES):
        identifier = layer.findtext("ows:Identifier", namespaces=NAMESPACES)
        if identifier in {wanted[0] for wanted in WANTED}:
            found[identifier] = layer
    out = []
    for identifier, dataset_id, title, resolution in WANTED:
        layer = found.get(identifier)
        if layer is None:
            continue
        matrix_set = layer.findtext("wmts:TileMatrixSetLink/wmts:TileMatrixSet", namespaces=NAMESPACES)
        extension = EXTENSIONS.get(layer.findtext("wmts:Format", namespaces=NAMESPACES) or "")
        level = re.search(r"Level(\d+)$", matrix_set or "")
        if not matrix_set or not extension or not level:
            continue
        time = None
        dimension = layer.find("wmts:Dimension", NAMESPACES)
        if dimension is not None:
            default = dimension.findtext("wmts:Default", namespaces=NAMESPACES)
            ranges = [value.text.split("/") for value in dimension.iterfind("wmts:Value", NAMESPACES) if value.text and value.text.count("/") == 2]
            if default and ranges and re.fullmatch(r"\d{4}-\d{2}-\d{2}", default):
                start, end, step = ranges[0][0][:10], ranges[-1][1][:10], ranges[-1][2]
                # The contract's steps are day and month, so a yearly composite is offered at its default date only.
                time = {"default": default, "start": default if step.endswith("Y") else start, "end": default if step.endswith("Y") else end,
                        "step": "day" if step.endswith("D") else "month"}
        if time is None:
            continue
        legend = layer.find("wmts:Style/wmts:LegendURL", NAMESPACES)
        legend_url = legend.get(XLINK_HREF) if legend is not None else None
        out.append({"id": identifier, "title": title, "kind": "data" if legend_url else "picture", "dataset_id": dataset_id,
                    "license": None, "license_url": None, "detail_of": None,
                    "url_template": f"{TILES}/{identifier}/default/{{time}}/{matrix_set}/{{z}}/{{y}}/{{x}}.{extension}",
                    "tile_size": 256, "min_zoom": 0, "max_zoom": int(level.group(1)), "attribution": "NASA EOSDIS GIBS",
                    "coverage_scope": "global", "native_resolution_m": resolution, "pre_rendered": True, "time": time, "legend_url": legend_url})
    with _CAP_LOCK:
        _CAP_CACHE[sig] = out
    return out
