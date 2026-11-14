"""Soil properties: the US soil survey where it exists, SoilGrids predictions elsewhere."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

import numpy as np
import rasterio
from rasterio.errors import RasterioError
from rasterio.io import MemoryFile

from app.adapters import raster
from app.adapters.base import Fetcher, FetchError, SourceState
from app.fusion.grid import Grid

SDA_URL = "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest"
SOILGRIDS_WCS = "https://maps.isric.org/mapserv"
WGS84 = "http://www.opengis.net/def/crs/EPSG/0/4326"
SOILGRIDS_PROPERTIES = ("wv0033", "wv1500", "sand", "clay", "soc")
# Every SoilGrids layer used here is stored as ten times its value.
SOILGRIDS_SCALE = 10.0
SOILGRIDS_WINDOW_DEG = 0.05
SOILGRIDS_OWN_PIXEL_KM = 0.25
SOILGRIDS_SPREAD_KM = 1.0
# Plant-available water by soil texture class, mm per metre (FAO-56, table 19). No soil it lists holds less than 50 or more than 200.
FAO_AWC_MM_PER_M = {"sand": (50.0, 110.0), "loamy sand": (60.0, 120.0), "sandy loam": (110.0, 150.0), "loam": (130.0, 180.0), "silt loam": (130.0, 190.0),
                    "silt": (160.0, 200.0), "silty clay loam": (130.0, 180.0), "silty clay": (130.0, 190.0), "clay": (120.0, 200.0)}
AWC_PLAUSIBLE_MM_PER_M = (50.0, 200.0)


def texture_class(sand: float, clay: float) -> str:
    """USDA soil texture class from percent sand and clay; silt is the remainder."""
    silt = 100.0 - sand - clay
    if silt + 1.5 * clay < 15:
        return "sand"
    if silt + 2 * clay < 30:
        return "loamy sand"
    if clay >= 40:
        return "silty clay" if silt >= 40 else "sandy clay" if sand > 45 else "clay"
    if clay >= 35 and sand > 45:
        return "sandy clay"
    if clay >= 27:
        return "silty clay loam" if sand <= 20 else "clay loam" if sand <= 45 else "sandy clay loam"
    if clay >= 20 and silt < 28 and sand > 45:
        return "sandy clay loam"
    if silt >= 80 and clay < 12:
        return "silt"
    if silt >= 50:
        return "silt loam"
    if clay >= 7 and silt >= 28 and sand <= 52:
        return "loam"
    return "sandy loam"
ROOT_ZONE_CM = 150.0
SOILGRIDS_DEPTHS = ("0-5cm", "5-15cm", "15-30cm", "30-60cm", "60-100cm")
SOILGRIDS_THICKNESS = (5.0, 10.0, 15.0, 30.0, 40.0)


@dataclass
class SoilProfile:
    """Field-level soil. Water holding is in mm of plant-available water per metre of soil."""

    source: str
    awc_mm_per_m: tuple[float, float, float]
    sand: float | None = None
    clay: float | None = None
    organic_matter: float | None = None
    k_factor: float | None = None
    wind_erodibility: float | None = None
    hydrologic_group: str | None = None
    units: list[dict] = field(default_factory=list)
    awc_grid: np.ndarray | None = None
    # Set when the soil map has nothing at the field and the nearest mapped soil was used.
    borrowed_km: float | None = None
    # How the values were arrived at, in words for the farmer.
    note: str | None = None
    k_grid: np.ndarray | None = None


def _number(value: object) -> float | None:
    try:
        return None if value in (None, "") else float(value)
    except (TypeError, ValueError):
        return None


def _weighted(pairs: list[tuple[float | None, float]]) -> float | None:
    usable = [(value, weight) for value, weight in pairs if value is not None and weight > 0]
    total = sum(weight for _, weight in usable)
    return sum(value * weight for value, weight in usable) / total if total else None


def _sda_rows(fetcher: Fetcher, sql: str) -> list[dict[str, object]]:
    table = fetcher.post_json("ssurgo", SDA_URL, json_body={"query": sql, "format": "JSON+COLUMNNAME"}, max_age_days=None).get("Table", [])
    if len(table) < 2:
        return []
    return [dict(zip(table[0], row)) for row in table[1:]]


def fetch_ssurgo(fetcher: Fetcher, grid: Grid) -> tuple[SoilProfile | None, SourceState]:
    try:
        unit_grid = raster.soil_map_units(fetcher, grid)
        if unit_grid is not None:
            keys, counts = np.unique(unit_grid[grid.mask], return_counts=True)
            shares = {int(key): float(count / counts.sum()) for key, count in zip(keys, counts) if key > 0}
        else:
            ring = ", ".join(f"{x:.6f} {y:.6f}" for x, y in grid.polygon_lonlat.exterior.coords)
            found = _sda_rows(fetcher, f"SELECT mukey FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('polygon(({ring}))')")
            shares = {int(row["mukey"]): 1.0 / len(found) for row in found}
        if not shares:
            return None, SourceState.out_of_coverage("ssurgo", "The US soil survey has no map unit at this field.")
        key_list = ", ".join(str(key) for key in sorted(shares))
        rows = _sda_rows(fetcher, f"""
            SELECT mu.mukey, mu.muname, c.cokey, c.compname, c.comppct_r, c.hydgrp, c.wei,
                   ch.hzdept_r, ch.hzdepb_r, ch.awc_l, ch.awc_r, ch.awc_h, ch.sandtotal_r, ch.claytotal_r, ch.om_r, ch.kwfact
            FROM mapunit mu
            JOIN component c ON c.mukey = mu.mukey AND c.majcompflag = 'Yes'
            LEFT JOIN chorizon ch ON ch.cokey = c.cokey
            WHERE mu.mukey IN ({key_list})
            ORDER BY mu.mukey, c.comppct_r DESC, ch.hzdept_r""")
    except FetchError as error:
        return None, SourceState.failed("ssurgo", error)
    if not rows:
        return None, SourceState.out_of_coverage("ssurgo", "The US soil survey has no description for the soils at this field.")

    units: dict[int, dict] = {}
    for row in rows:
        unit = units.setdefault(int(row["mukey"]), {"mukey": int(row["mukey"]), "name": row["muname"], "components": {}})
        component = unit["components"].setdefault(row["cokey"], {"percent": _number(row["comppct_r"]) or 0.0, "hydgrp": row["hydgrp"],
                                                                 "wei": _number(row["wei"]), "horizons": []})
        if row["hzdept_r"] is not None:
            component["horizons"].append(row)

    def unit_value(unit: dict, pick) -> float | None:
        return _weighted([(pick(component), component["percent"]) for component in unit["components"].values()])

    def root_zone(name: str):
        def pick(component: dict) -> float | None:
            layers = []
            for horizon in component["horizons"]:
                top, bottom = _number(horizon["hzdept_r"]), _number(horizon["hzdepb_r"])
                if top is None or bottom is None:
                    continue
                thickness = min(bottom, ROOT_ZONE_CM) - min(top, ROOT_ZONE_CM)
                layers.append((_number(horizon[name]), thickness))
            return _weighted(layers)
        return pick

    def surface(name: str):
        def pick(component: dict) -> float | None:
            tops = [h for h in component["horizons"] if _number(h["hzdept_r"]) == 0]
            return _number(tops[0][name]) if tops else None
        return pick

    summary = []
    for key, share in shares.items():
        unit = units.get(key)
        if unit is None:
            continue
        dominant = max(unit["components"].values(), key=lambda component: component["percent"])
        summary.append({"mukey": key, "name": unit["name"], "share": share,
                        "awc": [unit_value(unit, root_zone(name)) for name in ("awc_l", "awc_r", "awc_h")],
                        "sand": unit_value(unit, surface("sandtotal_r")), "clay": unit_value(unit, surface("claytotal_r")),
                        "om": unit_value(unit, surface("om_r")), "k": unit_value(unit, surface("kwfact")),
                        "wei": unit_value(unit, lambda component: component["wei"]), "hydgrp": dominant["hydgrp"]})
    if not summary or all(unit["awc"][1] is None for unit in summary):
        return None, SourceState.insufficient("ssurgo", "The soil survey lists no water-holding values for the soils at this field.")

    def field_value(pick) -> float | None:
        return _weighted([(pick(unit), unit["share"]) for unit in summary])

    representative = field_value(lambda unit: unit["awc"][1])
    awc = tuple(1000.0 * (field_value(lambda unit, i=i: unit["awc"][i]) or representative) for i in range(3))
    profile = SoilProfile(source="ssurgo", awc_mm_per_m=awc, sand=field_value(lambda u: u["sand"]), clay=field_value(lambda u: u["clay"]),
                          organic_matter=field_value(lambda u: u["om"]), k_factor=field_value(lambda u: u["k"]),
                          wind_erodibility=field_value(lambda u: u["wei"]),
                          hydrologic_group=max(summary, key=lambda unit: unit["share"])["hydgrp"],
                          units=[{k: v for k, v in unit.items()} for unit in summary])
    if unit_grid is not None:
        by_key = {unit["mukey"]: unit for unit in summary}
        profile.awc_grid = np.vectorize(lambda key: 1000.0 * (by_key[key]["awc"][1] or np.nan) if key in by_key else np.nan, otypes=[float])(unit_grid)
        profile.k_grid = np.vectorize(lambda key: (by_key[key]["k"] if key in by_key and by_key[key]["k"] is not None else np.nan), otypes=[float])(unit_grid)
    return profile, SourceState.ok("ssurgo")


def _soilgrids_window(fetcher: Fetcher, name: str, depth: str, lon: float, lat: float) -> tuple[np.ndarray, rasterio.Affine]:
    """SoilGrids' mean prediction of one property at one depth, for a small window around the point."""
    params = {"map": f"/map/{name}.map", "SERVICE": "WCS", "VERSION": "2.0.1", "REQUEST": "GetCoverage", "COVERAGEID": f"{name}_{depth}_mean",
              "FORMAT": "image/tiff", "SUBSET": [f"long({lon - SOILGRIDS_WINDOW_DEG:.4f},{lon + SOILGRIDS_WINDOW_DEG:.4f})",
                                                  f"lat({lat - SOILGRIDS_WINDOW_DEG:.4f},{lat + SOILGRIDS_WINDOW_DEG:.4f})"],
              "SUBSETTINGCRS": WGS84, "OUTPUTCRS": WGS84}
    content = fetcher.request("soilgrids", "GET", SOILGRIDS_WCS, params=params, max_age_days=None, timeout=45.0, attempts=3)
    with MemoryFile(content) as memory, memory.open() as source:
        return source.read(1).astype(float), source.transform


def fetch_soilgrids(fetcher: Fetcher, lon: float, lat: float) -> tuple[SoilProfile | None, SourceState]:
    """Soil at a point from SoilGrids. Where SoilGrids maps no soil at the point itself, as it does over many
    flooded rice fields and towns, the nearest mapped soil is used and the distance is reported."""
    lon, lat = round(lon, 4), round(lat, 4)
    wanted = [(name, depth) for name in SOILGRIDS_PROPERTIES for depth in SOILGRIDS_DEPTHS]
    try:
        with ThreadPoolExecutor(max_workers=10) as pool:
            windows = list(pool.map(lambda item: _soilgrids_window(fetcher, item[0], item[1], lon, lat), wanted))
    except (FetchError, RasterioError, ValueError) as error:
        return None, SourceState.failed("soilgrids", error)
    shape, transform = windows[0][0].shape, windows[0][1]
    if any(values.shape != shape for values, _ in windows):
        return None, SourceState.failed("soilgrids", "the soil layers came back on different grids")
    layers = {key: values for key, (values, _) in zip(wanted, windows)}
    mapped = np.all([values > 0 for values in layers.values()], axis=0)

    def profile(name: str) -> np.ndarray:
        """Depth-weighted mean of a property over the top metre, in its own units."""
        return sum(layers[(name, depth)] * thickness for depth, thickness in zip(SOILGRIDS_DEPTHS, SOILGRIDS_THICKNESS)) / sum(SOILGRIDS_THICKNESS) / SOILGRIDS_SCALE

    rows, cols = np.nonzero(mapped)
    if rows.size == 0:
        return None, SourceState.out_of_coverage("soilgrids", f"SoilGrids maps no soil within {SOILGRIDS_WINDOW_DEG * 111:.0f} km of this location (for example ice, open water or bare rock).")
    xs, ys = rasterio.transform.xy(transform, rows, cols)
    km_east = (np.asarray(xs) - lon) * 111.32 * np.cos(np.radians(lat))
    km_north = (np.asarray(ys) - lat) * 110.57
    nearest = int(np.argmin(np.hypot(km_east, km_north)))
    distance = float(np.hypot(km_east[nearest], km_north[nearest]))
    row, col = rows[nearest], cols[nearest]
    borrowed = distance if distance > SOILGRIDS_OWN_PIXEL_KM else None
    notes = [] if borrowed is None else [f"SoilGrids maps no soil at the field itself, so these values come from the nearest mapped soil, {borrowed:.1f} km away."]
    sand, clay = float(profile("sand")[row, col]), float(profile("clay")[row, col])

    # Field capacity minus wilting point, both in volume percent, gives plant-available water.
    awc = 10.0 * (profile("wv0033") - profile("wv1500"))
    here = float(awc[row, col])
    floor, ceiling = AWC_PLAUSIBLE_MM_PER_M
    if floor <= here <= ceiling:
        # SoilGrids' own error bands on the two water contents cannot be subtracted into a band on their difference,
        # so the range given is how much the mapped soils around the field differ.
        around = np.hypot(km_east - km_east[nearest], km_north - km_north[nearest]) <= SOILGRIDS_SPREAD_KM
        low, high = (float(np.clip(value, floor, ceiling)) for value in np.percentile(awc[rows[around], cols[around]], [10, 90]))
        holds = (min(low, here), here, max(high, here))
        notes.append(f"The range is how much the mapped soils within {SOILGRIDS_SPREAD_KM:g} km differ.")
    else:
        texture = texture_class(sand, clay)
        if texture not in FAO_AWC_MM_PER_M:
            return None, SourceState.insufficient("soilgrids", f"SoilGrids' water contents here give {here:.0f} mm per metre, outside the {floor:.0f} to {ceiling:.0f} "
                                                  f"that FAO lists for any soil, and FAO lists no range for a {texture} soil.")
        low, high = FAO_AWC_MM_PER_M[texture]
        holds = (low, (low + high) / 2.0, high)
        notes.append(f"SoilGrids' water contents here give {here:.0f} mm per metre, outside the {floor:.0f} to {ceiling:.0f} that FAO lists for any soil. "
                     f"The FAO range for a {texture} soil is used instead.")
    soil = SoilProfile(source="soilgrids", awc_mm_per_m=holds, sand=sand, clay=clay, organic_matter=float(profile("soc")[row, col]) * 0.1 * 1.724,
                       borrowed_km=borrowed, note=" ".join(notes))
    return soil, SourceState.ok("soilgrids", message=notes[0] if borrowed is not None else None)
