"""The analysis grid: one 30 m grid per field.

In the conterminous United States the grid is EPSG:5070 aligned to the Cropland Data Layer, so the
crop and soil rasters land on it without resampling. Elsewhere it is the field's UTM zone.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from functools import cached_property
from typing import Any

import numpy as np
from affine import Affine
from pyproj import Transformer
from rasterio import features
import shapely
from shapely.geometry import mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from app.core import config

US_GRID_CRS = "EPSG:5070"
# Cropland Data Layer cell edges fall 15 m off the 30 m lattice in both axes.
US_GRID_OFFSET_M = 15.0


class FieldError(ValueError):
    """The field geometry cannot be analysed. Carries a stable error type for the API."""

    def __init__(self, error_type: str, detail: str) -> None:
        super().__init__(detail)
        self.error_type = error_type


@dataclass
class Grid:
    crs: str
    transform: Affine
    shape: tuple[int, int]
    mask: np.ndarray
    polygon_lonlat: BaseGeometry
    polygon_xy: BaseGeometry

    @property
    def cell_size(self) -> float:
        return float(self.transform.a)

    @property
    def n_cells(self) -> int:
        return int(self.mask.sum())

    @property
    def area_ha(self) -> float:
        return float(self.polygon_xy.area / 10_000)

    @cached_property
    def centroid_lonlat(self) -> tuple[float, float]:
        centre = self.polygon_lonlat.centroid
        return float(centre.x), float(centre.y)

    @property
    def bounds_xy(self) -> tuple[float, float, float, float]:
        rows, cols = self.shape
        west, north = self.transform.c, self.transform.f
        return west, north + rows * self.transform.e, west + cols * self.transform.a, north

    @cached_property
    def to_lonlat(self) -> Transformer:
        return Transformer.from_crs(self.crs, 4326, always_xy=True)

    def signature(self) -> list[Any]:
        return [self.crs, [round(v, 3) for v in self.transform[:6]], list(self.shape)]

    def field_mean(self, values: np.ndarray) -> float | None:
        inside = values[self.mask]
        inside = inside[np.isfinite(inside)]
        return float(inside.mean()) if inside.size else None

    def classes_to_features(self, classes: np.ndarray, values: np.ndarray | None = None) -> list[dict[str, Any]]:
        """Dissolve grid cells of one class into polygons, clipped to the field, in longitude and latitude."""
        out = []
        for index in sorted(int(c) for c in np.unique(classes[self.mask])):
            member = (classes == index) & self.mask
            shapes = [shape(geometry) for geometry, flag in features.shapes(member.astype("uint8"), mask=member, transform=self.transform) if flag == 1]
            merged = unary_union(shapes).intersection(self.polygon_xy)
            if merged.is_empty:
                continue
            lonlat = reproject_geometry(merged, self.to_lonlat)
            mean = None
            if values is not None and np.isfinite(values[member]).any():
                mean = round(float(np.nanmean(values[member])), 3)
            out.append({"type": "Feature", "geometry": _rounded(mapping(lonlat)),
                        "properties": {"class_index": index, "value": mean, "area_ha": round(merged.area / 10_000, 2)}})
        return out


def reproject_geometry(geometry: BaseGeometry, transformer: Transformer) -> BaseGeometry:
    return shapely.transform(geometry, lambda points: np.column_stack(transformer.transform(points[:, 0], points[:, 1])))


def _rounded(geometry: dict[str, Any]) -> dict[str, Any]:
    def walk(node: Any) -> Any:
        if isinstance(node, (list, tuple)):
            if node and isinstance(node[0], (int, float)):
                return [round(float(node[0]), 6), round(float(node[1]), 6)]
            return [walk(child) for child in node]
        return node

    kind = geometry["type"]
    coordinates = walk(geometry["coordinates"])
    if kind == "GeometryCollection":
        raise FieldError("invalid_geometry", "The zone geometry could not be built.")
    return {"type": kind, "coordinates": coordinates}


def utm_crs(lon: float, lat: float) -> str:
    zone = int((lon + 180) // 6) % 60 + 1
    return f"EPSG:{(32600 if lat >= 0 else 32700) + zone}"


def read_field(geometry: dict[str, Any]) -> BaseGeometry:
    try:
        polygon = shape(geometry)
    except (ValueError, TypeError, KeyError, AttributeError) as error:
        raise FieldError("invalid_geometry", "The field boundary is not a valid polygon.") from error
    if polygon.is_empty or not polygon.is_valid or polygon.geom_type not in ("Polygon", "MultiPolygon"):
        raise FieldError("invalid_geometry", "The field boundary is not a valid polygon.")
    west, south, east, north = polygon.bounds
    if not (-180 <= west <= east <= 180 and -90 <= south <= north <= 90):
        raise FieldError("invalid_geometry", "The field boundary must be in longitude and latitude.")
    return polygon


def build_grid(geometry: dict[str, Any], *, conterminous_us: bool) -> Grid:
    polygon = read_field(geometry)
    lon, lat = polygon.centroid.x, polygon.centroid.y
    crs = US_GRID_CRS if conterminous_us else utm_crs(lon, lat)
    offset = US_GRID_OFFSET_M if conterminous_us else 0.0
    forward = Transformer.from_crs(4326, crs, always_xy=True)
    polygon_xy = reproject_geometry(polygon, forward)
    area_ha = polygon_xy.area / 10_000
    if area_ha < config.FIELD_AREA_MIN_HA:
        raise FieldError("field_too_small", f"The field is {area_ha:.2f} hectares. The smallest field this tool handles is {config.FIELD_AREA_MIN_HA} hectares.")
    if area_ha > config.FIELD_AREA_MAX_HA:
        raise FieldError("field_too_large", f"The field is {area_ha:.0f} hectares. The largest field this tool handles is {config.FIELD_AREA_MAX_HA:.0f} hectares.")
    cell = config.GRID_CELL_M
    west, south, east, north = polygon_xy.bounds
    x0 = math.floor((west - offset) / cell) * cell + offset
    y1 = math.ceil((north - offset) / cell) * cell + offset
    cols = max(1, math.ceil((east - x0) / cell))
    rows = max(1, math.ceil((y1 - south) / cell))
    transform = Affine(cell, 0, x0, 0, -cell, y1)
    mask = features.geometry_mask([mapping(polygon_xy)], out_shape=(rows, cols), transform=transform, invert=True, all_touched=False)
    if not mask.any():
        mask = features.geometry_mask([mapping(polygon_xy)], out_shape=(rows, cols), transform=transform, invert=True, all_touched=True)
    return Grid(crs=crs, transform=transform, shape=(rows, cols), mask=mask, polygon_lonlat=polygon, polygon_xy=polygon_xy)
