"""Map pictures sharp enough to recognise a field by, offered ahead of the 30 m NASA layers."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from app.adapters.base import Fetcher, FetchError
from app.adapters.gibs import tile_xy

USGS_TILES = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}"
NAIP_EXPORT = ("https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage"
               "?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&format=jpgpng&f=image")
EOX_TILES = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg"
EMPTY_TILE_BYTES = 2000


def _tile_url(template: str, lon: float, lat: float, zoom: int) -> str:
    x, y = tile_xy(lon, lat, zoom)
    return template.replace("{z}", str(zoom)).replace("{y}", str(y)).replace("{x}", str(x))


def _shows_ground(fetcher: Fetcher, source: str, template: str, lon: float, lat: float, zoom: int) -> bool:
    try:
        return len(fetcher.request(source, "GET", _tile_url(template, lon, lat, zoom), max_age_days=30, timeout=30, attempts=2)) > EMPTY_TILE_BYTES
    except FetchError:
        return False


def _layer(identifier: str, title: str, dataset_id: str, url: str, *, tile_size: int, zooms: tuple[int, int], attribution: str,
           license_name: str, license_url: str | None, scope: str, resolution: float, detail_of: str | None = None) -> dict:
    return {"id": identifier, "title": title, "kind": "picture", "dataset_id": dataset_id, "url_template": url, "tile_size": tile_size,
            "min_zoom": zooms[0], "max_zoom": zooms[1], "attribution": attribution, "license": license_name, "license_url": license_url,
            "coverage_scope": scope, "native_resolution_m": resolution, "pre_rendered": True, "time": None, "legend_url": None, "detail_of": detail_of}


def sharp_pictures(fetcher: Fetcher, lon: float, lat: float, *, conterminous_us: bool) -> list[dict]:
    """Only pictures whose tiles really show ground at this place."""
    with ThreadPoolExecutor(max_workers=2) as pool:
        usgs_future = pool.submit(_shows_ground, fetcher, "usgs_aerial", USGS_TILES, lon, lat, 16) if conterminous_us else None
        eox_future = pool.submit(_shows_ground, fetcher, "sentinel2_cloudless", EOX_TILES, lon, lat, 14)
        has_usgs = usgs_future.result() if usgs_future is not None else False
        has_eox = eox_future.result()
    out = []
    if has_usgs:
        out.append(_layer("usgs_aerial", "Aerial photo, about 2 m", "usgs_aerial", USGS_TILES, tile_size=256, zooms=(0, 16),
                          attribution="USDA, USGS The National Map: Orthoimagery", license_name="Public domain", license_url=None, scope="us_only", resolution=2.0))
        # The full-detail photo is rendered by the server on request and can take several seconds to arrive.
        out.append(_layer("usgs_naip_detail", "Aerial photo, full detail, 0.6 m", "usgs_naip", NAIP_EXPORT, tile_size=512, zooms=(15, 17),
                          attribution="USDA NAIP, served by USGS The National Map", license_name="Public domain", license_url=None, scope="us_only",
                          resolution=0.6, detail_of="usgs_aerial"))
    if has_eox:
        out.append(_layer("sentinel2_cloudless", "Cloud-free satellite picture from 2025, 10 m", "sentinel2_cloudless", EOX_TILES, tile_size=256, zooms=(0, 14),
                          attribution="Sentinel-2 cloudless by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2025)",
                          license_name="CC BY-NC-SA 4.0 (non-commercial use only)", license_url="https://creativecommons.org/licenses/by-nc-sa/4.0/",
                          scope="global", resolution=10.0))
    return out
