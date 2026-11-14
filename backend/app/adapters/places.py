"""Where a field is: country from Natural Earth, and for US fields the county from the Census geocoder."""

from __future__ import annotations

import threading
from dataclasses import dataclass

from shapely import STRtree
from shapely.geometry import Point, shape
from shapely.geometry.base import BaseGeometry

from app.adapters.base import Fetcher, FetchError

COUNTRIES_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson"
CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/geographies/coordinates"
# The crop map and the EPSG:5070 grid cover the conterminous states only.
NOT_CONTERMINOUS_STATE_FIPS = {"02", "15", "60", "66", "69", "72", "78"}
_INDEX_LOCK = threading.Lock()
_COUNTRY_INDEX: dict[tuple[str, str], tuple[STRtree, list[tuple[BaseGeometry, str | None, str | None, str | None]]]] = {}


def _country_index(fetcher: Fetcher) -> tuple[STRtree, list[tuple[BaseGeometry, str | None, str | None, str | None]]]:
    key = (str(fetcher.cache_dir), fetcher.mode)
    with _INDEX_LOCK:
        cached = _COUNTRY_INDEX.get(key)
    if cached is not None:
        return cached
    countries = fetcher.get_json("natural_earth", COUNTRIES_URL, max_age_days=None)
    entries: list[tuple[BaseGeometry, str | None, str | None, str | None]] = []
    geoms: list[BaseGeometry] = []
    for feature in countries["features"]:
        properties = feature["properties"]
        code = properties.get("ISO_A2_EH") or properties.get("ISO_A2")
        country_code = code if code and code != "-99" else None
        country_name = properties.get("NAME_LONG") or properties.get("NAME")
        geom = shape(feature["geometry"])
        geoms.append(geom)
        number = properties.get("ISO_N3_EH") or properties.get("ISO_N3")
        entries.append((geom, country_code, country_name, number.zfill(3) if number and number != "-99" else None))
    built = (STRtree(geoms), entries)
    with _INDEX_LOCK:
        _COUNTRY_INDEX[key] = built
    return built


@dataclass(frozen=True)
class Place:
    country_code: str | None
    country_name: str | None
    state_fips: str | None = None
    county_fips: str | None = None
    county_name: str | None = None
    # The UN M49 number of the country, which FAO's statistics are keyed by.
    country_m49: str | None = None

    @property
    def conterminous_us(self) -> bool:
        return self.country_code == "US" and self.state_fips is not None and self.state_fips not in NOT_CONTERMINOUS_STATE_FIPS


def locate(fetcher: Fetcher, lon: float, lat: float) -> Place:
    """Never raises: an unknown place is reported as such and the US-only sources are skipped."""
    country_code = country_name = country_m49 = None
    try:
        tree, entries = _country_index(fetcher)
        point = Point(lon, lat)
        for index in sorted(int(i) for i in tree.query(point, predicate="within")):
            _, country_code, country_name, country_m49 = entries[index]
            break
    except (FetchError, KeyError, ValueError):
        pass
    if country_code not in (None, "US"):
        return Place(country_code, country_name, country_m49=country_m49)
    try:
        params = {"x": round(lon, 6), "y": round(lat, 6), "benchmark": "Public_AR_Current", "vintage": "Current_Current",
                  "layers": "Counties", "format": "json"}
        payload = fetcher.get_json("us_census", CENSUS_URL, params=params, max_age_days=None)
        counties = payload["result"]["geographies"].get("Counties", [])
        if counties:
            county = counties[0]
            return Place("US", "United States", county["STATE"], county["COUNTY"], county["NAME"], country_m49)
    except (FetchError, KeyError, ValueError):
        pass
    return Place(country_code, country_name, country_m49=country_m49)
