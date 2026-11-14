"""Field-level evidence, series, zones and the top-level Analysis document."""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
from typing import Any

import numpy as np

from app.adapters import raster
from app.core import config
from app.core.provenance import DATASETS, NOT_CONFIGURED_MESSAGES, PRIORITY_LABELS, DISCLAIMER, ZONE_HAZARD_LABELS, AccessTier, EvidenceKind, NullReason, missing, quantity
from app.modeling import rotations
from app.modeling.engine import Evaluated, Gathered, listed
from app.modeling.report import BARE_NDVI, WEATHER_PERIOD, Builder, _pct
from app.modeling.simulate import HAZARDS, Draws

TREND_FLAT = {"cm/yr": 0.1, "ft/yr": 0.1, "m/yr": 0.03}


def _level(share: float) -> int:
    return 2 if share >= config.RISK_LEVEL_SHARES[1] else 1 if share >= config.RISK_LEVEL_SHARES[0] else 0


def _direction(slope: float, unit: str, *, positive_means_falling: bool) -> str:
    flat = TREND_FLAT.get(unit, 0.1)
    if abs(slope) < flat:
        return "steady"
    return "falling" if (slope > 0) == positive_means_falling else "rising"


def field_evidence(b: Builder, current: Evaluated | None = None) -> tuple[list[dict], list[dict], list[dict]]:
    """Evidence about the field itself, the time series behind it, and satellite-against-ground pairs."""
    g = b.g
    evidence, series, pairs = [], [], []
    climate = g.climate
    years = [int(y) for y in climate.years]

    rain_median, rain_low, rain_high = _pct(climate.annual_rain)
    note = None
    if climate.rain_alt is not None:
        other = float(climate.rain_alt.sum(axis=1).mean())
        mean = float(climate.annual_rain.mean())
        note = f"ERA5 gives {other:.0f} mm a year for the same years, {abs(other - mean) / mean:.0%} {'more' if other > mean else 'less'} than NASA POWER."
    by_year = defaultdict(list)
    for month, value in g.imerg.items():
        by_year[int(month[:4])].append(value)
    satellite_rain = {year: sum(values) for year, values in sorted(by_year.items()) if len(values) == 12 and year in years}
    if satellite_rain:
        seen = float(np.mean(list(satellite_rain.values())))
        same_years = float(np.mean([climate.annual_rain[years.index(year)] for year in satellite_rain]))
        note = " ".join(filter(None, [note, f"NASA's IMERG satellite record gives {seen:.0f} mm a year over {len(satellite_rain)} of those years, "
                                            f"{abs(seen - same_years) / same_years:.0%} {'more' if seen > same_years else 'less'} than NASA POWER."]))
        series.append({"id": "annual-rain-imerg", "label": "Rain each year, GPM IMERG satellites", "unit": "mm/yr", "cadence": "yearly", "evidence_kind": EvidenceKind.SATELLITE.value,
                       "access_tier": AccessTier.LIVE.value, "dataset_ids": ["gpm_imerg"], "native_resolution_m": DATASETS["gpm_imerg"].native_resolution_m,
                       "points": [{"t": f"{year}-01-01", "value": round(total, 0), "n_valid_obs": 12, "n_expected_obs": 12} for year, total in satellite_rain.items()]})
    rain_quantity = quantity(rain_median, "mm/yr", kind=EvidenceKind.MODEL, tier=AccessTier.LIVE, datasets=b.weather, low=rain_low, high=rain_high,
                             period=WEATHER_PERIOD, n_valid=len(years), n_expected=len(years), note=note, digits=0)
    evidence.append({"id": "rainfall", "kind": "rainfall_reliability", "title": "Rain in a year", "summary": f"Half of years bring more than {rain_median:.0f} mm; one year in ten brings less than {rain_low:.0f} mm.",
                     "quantity": rain_quantity, "series_id": "annual-rain"})
    series.append({"id": "annual-rain", "label": "Rain each year, NASA POWER", "unit": "mm/yr", "cadence": "yearly", "evidence_kind": EvidenceKind.MODEL.value,
                   "access_tier": AccessTier.LIVE.value, "dataset_ids": ["nasa_power"], "native_resolution_m": DATASETS["nasa_power"].native_resolution_m,
                   "points": [{"t": f"{year}-01-01", "value": round(float(v), 0), "n_valid_obs": 365, "n_expected_obs": 365} for year, v in zip(years, climate.annual_rain)]})
    if climate.rain_alt is not None:
        series.append({"id": "annual-rain-era5", "label": "Rain each year, ERA5", "unit": "mm/yr", "cadence": "yearly", "evidence_kind": EvidenceKind.MODEL.value,
                       "access_tier": AccessTier.LIVE.value, "dataset_ids": ["era5_open_meteo"], "native_resolution_m": DATASETS["era5_open_meteo"].native_resolution_m,
                       "points": [{"t": f"{year}-01-01", "value": round(float(v), 0), "n_valid_obs": 365, "n_expected_obs": 365} for year, v in zip(years, climate.rain_alt.sum(axis=1))]})

    hot = (climate.tmax >= config.HEAT_DAY_C).sum(axis=1)
    median, low, high = _pct(hot)
    evidence.append({"id": "heat-days", "kind": "heat_stress", "title": f"Days at or above {config.HEAT_DAY_C:g} °C in a year", "summary": f"About {median:.0f} such days in a typical year, {high:.0f} in a hot one.",
                     "quantity": quantity(median, "days/yr", kind=EvidenceKind.MODEL, tier=AccessTier.LIVE, datasets=["nasa_power"], low=low, high=high, period=WEATHER_PERIOD, n_valid=len(years), n_expected=len(years), digits=0), "series_id": None})
    evidence.append({"id": "frost-free", "kind": "frost_risk", "title": "Frost-free season", "summary": f"About {g.frost_free_days:.0f} days pass between the last spring frost and the first autumn frost in a typical year.",
                     "quantity": quantity(g.frost_free_days, "days", kind=EvidenceKind.MODEL, tier=AccessTier.LIVE, datasets=["nasa_power"], low=g.frost_free_days, high=g.frost_free_days, period=WEATHER_PERIOD, n_valid=len(years), n_expected=len(years), digits=0), "series_id": None})
    heavy_days = (climate.rain >= climate.heavy_rain_mm).sum(axis=1)
    median, low, high = _pct(heavy_days)
    evidence.append({"id": "heavy-rain", "kind": "extreme_rain", "title": "Heavy-rain days in a year", "summary": f"A heavy-rain day here means {climate.heavy_rain_mm:.0f} mm or more. About {median:.0f} come in a typical year.",
                     "quantity": quantity(median, "days/yr", kind=EvidenceKind.MODEL, tier=AccessTier.LIVE, datasets=["nasa_power"], low=low, high=high, period=WEATHER_PERIOD, n_valid=len(years), n_expected=len(years), digits=0), "series_id": None})

    if g.soil is not None:
        low, mid, high = g.soil.awc_mm_per_m
        names = "; ".join(f"{unit['name']} ({unit['share']:.0%})" for unit in g.soil.units) or None
        names = g.soil.note or names
        evidence.append({"id": "soil-water", "kind": "soil_property", "title": "Water the soil can hold for crops", "summary": f"About {mid:.0f} mm of usable water in each metre of soil.",
                         "quantity": quantity(mid, "mm/m", kind=EvidenceKind.SOIL_SURVEY, tier=AccessTier.LIVE, datasets=b.soil, low=low, high=high, note=names,
                                              needs_local=g.soil.source == "soilgrids", digits=0), "series_id": None})
    else:
        evidence.append({"id": "soil-water", "kind": "soil_property", "title": "Water the soil can hold for crops", "summary": "No soil values are available for this field.",
                         "quantity": b.soil_missing("mm/m"), "series_id": None})
    if g.slope_percent is not None and g.grid.field_mean(g.slope_percent) is not None:
        inside = g.slope_percent[g.grid.mask]
        evidence.append({"id": "slope", "kind": "slope_erosion", "title": "Slope of the field", "summary": f"The field slopes {float(np.mean(inside)):.1f}% on average, {float(np.max(inside)):.1f}% at its steepest.",
                         "quantity": quantity(float(np.mean(inside)), "percent", kind=EvidenceKind.SATELLITE, tier=AccessTier.LIVE, datasets=["nasadem"], low=float(np.min(inside)), high=float(np.max(inside)),
                                              n_valid=g.grid.n_cells, n_expected=g.grid.n_cells), "series_id": None})

    if g.county_shares:
        main = b.baseline.years[0].crop
        share = g.county_shares.get(main.id)
        if share is not None:
            evidence.append({"id": "county-crops", "kind": "market_presence", "title": f"{main.name} in this county", "summary": f"{main.name} covered {share:.0%} of the county's cropland in {config.CROP_HISTORY_LAST_YEAR}.",
                             "quantity": quantity(share, "fraction", kind=EvidenceKind.SATELLITE, tier=AccessTier.LIVE, datasets=["usda_cdl"],
                                                  period=(f"{config.CROP_HISTORY_LAST_YEAR}-01-01", f"{config.CROP_HISTORY_LAST_YEAR}-12-31")), "series_id": None})

    if g.scenes:
        by_month: dict[str, list[float]] = defaultdict(list)
        for scene in g.scenes:
            by_month[scene.day.isoformat()[:7]].append(scene.ndvi)
        passes: dict[str, int] = defaultdict(int)
        for day in g.pass_days:
            passes[day.isoformat()[:7]] += 1
        series.append({"id": "green-cover", "label": "How green the field was, by month", "unit": "index", "cadence": "monthly", "evidence_kind": EvidenceKind.SATELLITE.value,
                       "access_tier": AccessTier.LIVE.value, "dataset_ids": ["sentinel2"], "native_resolution_m": DATASETS["sentinel2"].native_resolution_m,
                       "points": [{"t": f"{month}-01", "value": round(float(np.mean(by_month[month])), 3) if month in by_month else None,
                                   "n_valid_obs": len(by_month.get(month, [])), "n_expected_obs": count} for month, count in sorted(passes.items())]})
        full_years = sorted({scene.day.year for scene in g.scenes} - {b.today_year})
        per_year = []
        for year in full_years:
            mine = [scene.ndvi for scene in g.scenes if scene.day.year == year]
            if len(mine) >= 6:
                per_year.append(52.0 * sum(value < BARE_NDVI for value in mine) / len(mine))
        if per_year:
            evidence.append({"id": "green-cover", "kind": "bare_field_window", "title": "Weeks a year with almost nothing green on the field",
                             "summary": f"On clear satellite passes the field showed almost no green cover for about {np.median(per_year):.0f} weeks a year. Stubble looks the same as bare soil from orbit.",
                             "quantity": quantity(float(np.median(per_year)), "weeks/yr", kind=EvidenceKind.SATELLITE, tier=AccessTier.LIVE, datasets=["sentinel2"], low=float(min(per_year)), high=float(max(per_year)),
                                                  period=(f"{full_years[0]}-01-01", f"{full_years[-1]}-12-31"), n_valid=len(g.scenes), n_expected=len(g.pass_days), needs_local=True,
                                                  note="A satellite cannot tell stubble from bare soil, so this counts both."), "series_id": "green-cover"})
    yearly = defaultdict(list)
    for month, value in g.openet.items():
        yearly[month[:4]].append(value)
    totals = {year: sum(values) for year, values in yearly.items() if len(values) == 12}
    if totals:
        measured = float(np.median(list(totals.values())))
        period = (f"{min(totals)}-01-01", f"{max(totals)}-12-31")
        series.append({"id": "field-water-use", "label": "Water leaving the field each month, OpenET", "unit": "mm", "cadence": "monthly",
                       "evidence_kind": DATASETS["openet"].evidence_kind.value, "access_tier": AccessTier.LIVE.value, "dataset_ids": ["openet"],
                       "native_resolution_m": DATASETS["openet"].native_resolution_m,
                       "points": [{"t": f"{month}-01", "value": round(value, 1), "n_valid_obs": 1, "n_expected_obs": 1} for month, value in sorted(g.openet.items())]})
        beside = ""
        if current is not None and current.sim.annual_use is not None:
            beside = f" The water model here puts your current rotation at about {float(np.median(current.sim.annual_use)):.0f} mm a year when the crops are never short."
        evidence.append({"id": "field-water-use", "kind": "evapotranspiration", "title": "Water this field has actually been using",
                         "summary": f"About {measured:.0f} mm of water left this field in a typical year from {min(totals)} to {max(totals)}, by crop use and evaporation together. "
                                    f"OpenET works this out from Landsat satellite pictures.{beside}",
                         "quantity": quantity(measured, "mm/yr", kind=DATASETS["openet"].evidence_kind, tier=AccessTier.LIVE, datasets=["openet"], low=float(min(totals.values())),
                                              high=float(max(totals.values())), period=period, n_valid=len(totals), n_expected=len(yearly), needs_local=True,
                                              note="An estimate from satellite pictures, not a meter reading. The range is the lowest and highest year."), "series_id": "field-water-use"})
    peaks = {}
    for year in sorted({scene.day.year for scene in g.greenness}):
        mine = [scene.ndvi for scene in g.greenness if scene.day.year == year]
        if len(mine) >= config.GREENNESS_MIN_COMPOSITES:
            peaks[year] = max(mine)
    if len(peaks) >= 5:
        usual = float(np.median(list(peaks.values())))
        low_years = [year for year, peak in peaks.items() if peak < config.LOW_GREENNESS_SHARE * usual]
        resolution = DATASETS["modis_vegetation"].native_resolution_m
        series.append({"id": "greenness-history", "label": "The greenest the field got each year, MODIS", "unit": "index", "cadence": "yearly",
                       "evidence_kind": EvidenceKind.SATELLITE.value, "access_tier": AccessTier.LIVE.value, "dataset_ids": ["modis_vegetation"], "native_resolution_m": resolution,
                       "points": [{"t": f"{year}-01-01", "value": round(peak, 3), "n_valid_obs": sum(scene.day.year == year for scene in g.greenness), "n_expected_obs": 23}
                                  for year, peak in peaks.items()]})
        named = ", ".join(str(year) for year in low_years)
        found = f"In {len(low_years)} of {len(peaks)} years the field stayed well short of its usual peak greenness: {named}." if low_years else f"In all {len(peaks)} years the field reached close to its usual peak greenness."
        evidence.append({"id": "greenness-history", "kind": "vegetation_stress_window", "title": "Years the field stayed less green than usual",
                         "summary": found + (" A dry year, a different crop or a fallow year can each cause this." if low_years else ""),
                         "quantity": quantity(usual, "index", kind=EvidenceKind.SATELLITE, tier=AccessTier.LIVE, datasets=["modis_vegetation"],
                                              low=float(np.percentile(list(peaks.values()), 10)), high=float(np.percentile(list(peaks.values()), 90)),
                                              period=(f"{min(peaks)}-01-01", f"{max(peaks)}-12-31"), n_valid=len(peaks), n_expected=b.today_year - raster.MODIS_FIRST_YEAR + 1, needs_local=True,
                                              note=f"Each reading covers a {resolution:g} m square, so on a small field it includes the neighbours."), "series_id": "greenness-history"})
    if not g.scenes and "sentinel2" in g.states:
        state = g.states["sentinel2"]
        reason = state.null_reason or NullReason.INSUFFICIENT
        text = state.message or f"Only {len(g.scenes)} of {len(g.pass_days)} satellite passes were clear enough to read the field."
        evidence.append({"id": "green-cover", "kind": "bare_field_window", "title": "Weeks a year with almost nothing green on the field", "summary": text,
                         "quantity": missing("weeks/yr", reason, text, datasets=["sentinel2"]), "series_id": None})

    satellite_storage = missing("cm/yr", NullReason.NOT_CONFIGURED, NOT_CONFIGURED_MESSAGES["grace_fo"], datasets=["grace_fo"])

    if g.wells is not None:
        ground = quantity(g.wells.median_slope, g.wells.unit, kind=EvidenceKind.GROUND, tier=AccessTier.LIVE, datasets=["usgs_groundwater"], low=g.wells.low_slope, high=g.wells.high_slope,
                          period=(f"{g.wells.first_year}-01-01", f"{g.wells.last_year}-12-31"), n_valid=g.wells.n_measurements, n_expected=None,
                          note=f"Depth to water in {g.wells.n_wells} wells; positive means the water table is falling. The record ends in {g.wells.last_year}.", needs_local=True)
        evidence.append({"id": "groundwater", "kind": "groundwater_trend", "title": "Depth to water in nearby wells",
                         "summary": f"The water table fell in {g.wells.falling_share:.0%} of {g.wells.n_wells} wells within {config.WELL_SEARCH_RADIUS_KM:.0f} km, by about {g.wells.median_slope:.1f} {g.wells.unit.split('/')[0]} a year. Readings stop in {g.wells.last_year}.",
                         "quantity": ground, "series_id": None})
    else:
        ground = b.unavailable("ft/yr", "usgs_groundwater", "No well records are available for this location.")
    both = satellite_storage["value"] is not None and ground["value"] is not None
    agreement = "not_comparable"
    if both:
        up = _direction(satellite_storage["value"], "cm/yr", positive_means_falling=False)
        down = _direction(ground["value"], ground["unit"], positive_means_falling=True)
        agreement = "consistent" if up == down else "differs"
    pairs.append({"id": "water-storage-vs-wells", "label": "Water under the ground: satellite against wells", "satellite": satellite_storage, "ground": ground,
                  "comparison_basis": "trend_direction" if both else "none", "agreement": agreement, "difference": None,
                  "rule": "The two measure different things in different units, so only the direction is compared: falling, steady or rising. A change smaller than 0.1 cm a year by satellite, or 0.1 ft a year in wells, counts as steady.",
                  "ground_site_count": g.wells.n_wells if g.wells else None, "ground_distance_km": round(g.wells.nearest_km, 1) if g.wells and np.isfinite(g.wells.nearest_km) else None})
    pairs.append({"id": "rainfall-vs-gauge", "label": "Rain in a year: weather model against rain gauges", "satellite": rain_quantity,
                  "ground": missing("mm/yr", NullReason.NOT_CONFIGURED, "No rain-gauge source is set up in this version, so the rainfall record cannot be checked against a gauge near you."),
                  "comparison_basis": "none", "agreement": "not_comparable", "difference": None,
                  "rule": "With a gauge within reach, yearly totals would be compared and counted as consistent within 15%.", "ground_site_count": None, "ground_distance_km": None})

    return evidence, series, pairs


def zones(b: Builder, current: Evaluated, analysis_id: str) -> tuple[dict, list[dict]]:
    g, grid = b.g, b.g.grid
    labels = {hazard: label for hazard, label, _ in ZONE_HAZARD_LABELS}
    whole = np.zeros(grid.shape, dtype=int)
    layers = []

    def layer(hazard: str, *, field_wide: bool, kind: EvidenceKind | None, tier: AccessTier | None, datasets: list[str], resolution: float | None,
              unit: str | None, classes: list[dict], features: list[dict] | None, reason: dict | None = None, needs_local: bool = False,
              period: tuple[str, str] | None = None) -> dict:
        return {"hazard": hazard, "label": labels[hazard], "field_wide": field_wide, "evidence_kind": kind.value if kind else None,
                "access_tier": tier.value if tier else None, "dataset_ids": datasets, "native_resolution_m": resolution,
                "period": None if period is None else {"start": period[0], "end": period[1]}, "n_valid_obs": grid.n_cells if features else None,
                "n_expected_obs": grid.n_cells if features else None, "unit": unit, "classes": classes,
                "null_reason": reason["null_reason"] if reason else None, "null_explanation": reason["null_explanation"] if reason else None,
                "retryable": bool(reason and reason["retryable"]), "needs_local_judgment": needs_local,
                "features": None if features is None else {"type": "FeatureCollection", "features": features}}

    def relative(values: np.ndarray, *, higher_is_riskier: bool) -> tuple[np.ndarray, list[dict], bool]:
        inside = values[grid.mask & np.isfinite(values)]
        spread = (np.percentile(inside, 90) - np.percentile(inside, 10)) / max(abs(float(np.median(inside))), 1e-9) if inside.size else 0.0
        if inside.size < 6 or spread < 0.1:
            return whole, [{"index": 0, "label": "Lower", "min": round(float(inside.min()), 3) if inside.size else None, "max": round(float(inside.max()), 3) if inside.size else None}], True
        cuts = np.percentile(inside, [100 / 3, 200 / 3])
        ordered = np.digitize(np.nan_to_num(values, nan=float(np.median(inside))), cuts)
        classes = ordered if higher_is_riskier else 2 - ordered
        bounds = [float(inside.min()), float(cuts[0]), float(cuts[1]), float(inside.max())]
        legend = []
        for index, name in enumerate(("Lower", "Raised", "High")):
            band = index if higher_is_riskier else 2 - index
            legend.append({"index": index, "label": name, "min": round(bounds[band], 3), "max": round(bounds[band + 1], 3)})
        return classes, legend, False

    if g.slope_percent is not None:
        rise = g.slope_percent / 100.0
        sine = rise / np.sqrt(1 + rise**2)
        # RUSLE slope-steepness factor (McCool et al. 1987): one form below 9% slope, another above.
        steepness = np.where(g.slope_percent < 9.0, 10.8 * sine + 0.03, 16.8 * sine - 0.5)
        erodibility = g.soil.k_grid if g.soil is not None and g.soil.k_grid is not None else None
        index = steepness * (np.nan_to_num(erodibility, nan=float(np.nanmean(erodibility))) if erodibility is not None and np.isfinite(erodibility).any() else 1.0)
        classes, legend, uniform = relative(index, higher_is_riskier=True)
        layers.append(layer("erosion", field_wide=uniform, kind=EvidenceKind.MODEL, tier=AccessTier.MODELED, datasets=["nasadem"] + (["ssurgo"] if erodibility is not None else []),
                            resolution=30.0, unit="index", classes=legend, features=grid.classes_to_features(classes, index), needs_local=True))
    else:
        reason = b.unavailable("index", "nasadem", "No elevation data is available for this field, so slope cannot be mapped.")
        layers.append(layer("erosion", field_wide=True, kind=None, tier=None, datasets=["nasadem"], resolution=None, unit=None, classes=[], features=None, reason=reason))

    if g.soil is not None and g.soil.awc_grid is not None:
        classes, legend, uniform = relative(g.soil.awc_grid, higher_is_riskier=False)
        layers.append(layer("water_stress", field_wide=uniform, kind=EvidenceKind.SOIL_SURVEY, tier=AccessTier.LIVE, datasets=["ssurgo"], resolution=DATASETS["ssurgo"].native_resolution_m,
                            unit="mm/m", classes=legend, features=grid.classes_to_features(classes, g.soil.awc_grid)))
    elif g.soil is not None:
        value = np.full(grid.shape, g.soil.awc_mm_per_m[1])
        layers.append(layer("water_stress", field_wide=True, kind=EvidenceKind.SOIL_SURVEY, tier=AccessTier.LIVE, datasets=b.soil, resolution=DATASETS[g.soil.source].native_resolution_m,
                            unit="mm/m", classes=[{"index": 0, "label": "Lower", "min": round(g.soil.awc_mm_per_m[0], 1), "max": round(g.soil.awc_mm_per_m[2], 1)}],
                            features=grid.classes_to_features(whole, value), needs_local=True))
    else:
        layers.append(layer("water_stress", field_wide=True, kind=None, tier=None, datasets=[], resolution=None, unit=None, classes=[], features=None, reason=b.soil_missing("mm/m")))

    for hazard, days in (("heat", current.sim.heat_days), ("frost", current.sim.frost_days)):
        share = float(current.sim.hazard_month[:, :, HAZARDS.index(hazard)].max())
        level = _level(share)
        value = np.full(grid.shape, float(np.median(days)))
        layers.append(layer(hazard, field_wide=True, kind=EvidenceKind.MODEL, tier=AccessTier.MODELED, datasets=b.weather, resolution=DATASETS["nasa_power"].native_resolution_m,
                            unit="days/yr", classes=[{"index": level, "label": ("Lower", "Raised", "High")[level], "min": None, "max": None}],
                            features=grid.classes_to_features(whole + level, value), period=WEATHER_PERIOD))

    payload = {"analysis_id": analysis_id, "grid": {"crs": grid.crs, "cell_size_m": grid.cell_size, "n_cells": grid.n_cells}, "layers": layers}
    summary = [{"hazard": item["hazard"], "available": item["features"] is not None, "field_wide": item["field_wide"], "null_reason": item["null_reason"]} for item in layers]
    return payload, summary


def drivers(current: Evaluated, draws: Draws) -> list[dict]:
    """Share of the spread in the overall score that follows each source of uncertainty, from the spread of group means."""
    labels = {"weather_variability": "Year-to-year weather", "soil_properties": "How much water the soil holds",
              "crop_parameters": "Crop coefficients and planting dates", "rainfall_source_disagreement": "Disagreement between rainfall records"}
    total = current.overall
    if total is None or float(np.var(total)) < 1e-9:
        return [{"id": name, "label": label, "share": None} for name, label in labels.items()]

    def effect(groups: np.ndarray) -> float:
        return float(np.var([total[groups == value].mean() for value in np.unique(groups)]))

    bins = lambda u: np.minimum((u * 5).astype(int), 4)  # noqa: E731
    effects = {"weather_variability": effect(draws.year_index[:, 0]), "soil_properties": effect(bins(draws.soil_u)),
               "crop_parameters": effect(bins(draws.crop_v)) + effect(bins(draws.plant_z)),
               "rainfall_source_disagreement": effect(draws.use_alt_rain.astype(int)) if draws.use_alt_rain.any() else 0.0}
    whole = sum(effects.values()) or 1.0
    return [{"id": name, "label": labels[name], "share": round(value / whole, 3)} for name, value in effects.items()]


def close_call_among(ranked: list[tuple[str, np.ndarray]], current_id: str, names: dict[str, str]) -> dict | None:
    """Every rotation the first-ranked one is not clearly ahead of, best first. None when its lead over each is clear."""
    (lead_id, lead), *others = ranked
    shares = {rival_id: float((lead > rival).mean()) for rival_id, rival in others
              if float((lead > rival).mean()) < config.CLOSE_CALL_SHARE or float(np.median(lead) - np.median(rival)) < config.TRADEOFF_SIMILAR_DELTA}
    if not shares:
        return None
    closest = min(shares, key=shares.get)
    wins = f"\u201c{names[lead_id]}\u201d scored higher in {round(shares[closest] * lead.size)} of {lead.size} weather years against \u201c{names[closest]}\u201d."
    if current_id in shares:
        text = (f"What you grow now fits what matters to you about as well as \u201c{names[lead_id]}\u201d. {wins} "
                "The scores alone do not make a case for switching; the measures show what would change.")
    else:
        text = f"{listed([chr(0x201C) + names[rotation_id] + chr(0x201D) for rotation_id in [lead_id, *shares]])} fit what matters to you about equally. {wins}"
    return {"rotation_ids": [lead_id, *shares], "share_of_runs_first_ahead": round(shares[closest], 3), "text": text}


def build(request: dict[str, Any], gathered: Gathered, results: list[Evaluated], baseline: rotations.Baseline, draws: Draws,
          weights: dict[str, float], seed_hex: str, analysis_id: str, today_year: int) -> tuple[dict, dict]:
    b = Builder(request, gathered, results, baseline, draws, weights, seed_hex)
    b.today_year = today_year
    current = results[0]
    first = request["farmer"]["priorities"][0]
    if any(result.scores[config.PRIORITY_TO_SCORE[first]] is None for result in results):
        wanted = next(label for priority, label, _ in PRIORITY_LABELS if priority == first)
        b.unranked = (f"Your first priority, \"{wanted}\", could not be scored for every rotation at this field, so the rotations are not ranked. "
                      "Compare them one score at a time.")
        for result in results:
            result.overall = None
    labels = {priority: label for priority, label, _ in PRIORITY_LABELS}
    left_out = [priority for priority in request["farmer"]["priorities"] if any(result.scores[config.PRIORITY_TO_SCORE[priority]] is None for result in results)]
    counted = [priority for priority in request["farmer"]["priorities"] if priority not in left_out]
    ranking_note = None
    if left_out and b.unranked is None:
        ranking_note = (f"{listed([labels[p] for p in left_out])} could not be scored for every rotation at this field, so this ranking leaves "
                        f"{'it' if len(left_out) == 1 else 'them'} out. It covers {listed([labels[p].lower() for p in counted])} only.")
    scored = [result for result in results if result.overall is not None]
    medians = {result.id: float(np.median(result.overall)) for result in scored}
    order = sorted(medians, key=lambda key: -medians[key])
    wins = np.argmax(np.stack([result.overall for result in scored]), axis=0) if scored else np.array([])
    first_share = {result.id: round(float((wins == index).mean()), 3) for index, result in enumerate(scored)}
    ordered = [current] + sorted(results[1:], key=lambda result: -medians.get(result.id, -1.0))
    built = [b.rotation(result, current, order.index(result.id) + 1 if result.id in medians else None, first_share.get(result.id)) for result in ordered]
    close_call = None
    if len(order) >= 2:
        by_id = {result.id: result.overall for result in scored}
        close_call = close_call_among([(key, by_id[key]) for key in order], current.id, {entry["id"]: entry["label"] for entry in built})

    evidence, series, pairs = field_evidence(b, current)
    zone_payload, zone_summary = zones(b, current, analysis_id)
    grid, place = gathered.grid, gathered.place
    farmer = request["farmer"]
    scenario = request.get("scenario") or {}
    rainfall_id, temperature_id = scenario.get("rainfall", "normal"), scenario.get("temperature", "normal")
    rain_spec, temp_spec = config.RAINFALL_SCENARIOS[rainfall_id], config.TEMPERATURE_SCENARIOS[temperature_id]
    pool = np.sort(gathered.climate.annual_rain)[: max(2, round(len(gathered.climate.years) * rain_spec["driest_share"]))]
    mean_temperature = (gathered.climate.tmax + gathered.climate.tmin).mean(axis=1) / 2

    gaps = []
    for dataset in b.datasets():
        if dataset["status"] != "available" and dataset["null_reason"] in ("not_configured", "fetch_failed"):
            gaps.append({"id": f"source-{dataset['id']}", "text": dataset["message"], "affects": [], "dataset_id": dataset["id"], "null_reason": dataset["null_reason"]})
    gaps.append({"id": "footprint", "text": "Weather comes from grid cells about 55 km wide and soil moisture from 9 km squares. They describe your area, not your field alone.",
                 "affects": ["water_balance", "climate_risk"], "dataset_id": "nasa_power", "null_reason": None})
    gaps.append({"id": "soil-loss", "text": "Soil loss in tonnes is not worked out. Erosion is shown as weeks of bare soil in the wettest and windiest months instead.",
                 "affects": ["erosion"], "dataset_id": None, "null_reason": None})

    analysis = {
        "contract_version": config.CONTRACT_VERSION, "analysis_id": analysis_id,
        "created_at": datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"), "disclaimer": DISCLAIMER, "request": request,
        "field": {"name": request["field"].get("name"), "area_ha": round(grid.area_ha, 2), "centroid": {"lat": round(grid.centroid_lonlat[1], 5), "lon": round(grid.centroid_lonlat[0], 5)},
                  "country_code": place.country_code, "coverage_scopes": ["global"] + (["us_only"] if place.conterminous_us else []),
                  "grid": {"crs": grid.crs, "cell_size_m": grid.cell_size, "n_cells": grid.n_cells}},
        "datasets": b.datasets(),
        "scenario": {
            "rainfall": {"id": rainfall_id, "label": rain_spec["label"], "definition": rain_spec["definition"],
                         "quantity": quantity(float(np.median(pool)), "mm/yr", kind=EvidenceKind.MODEL, tier=AccessTier.LIVE, datasets=["nasa_power"], low=float(pool.min()), high=float(pool.max()),
                                              period=WEATHER_PERIOD, n_valid=int(pool.size), n_expected=int(pool.size), digits=0)},
            "temperature": {"id": temperature_id, "label": temp_spec["label"], "definition": temp_spec["definition"],
                            "quantity": quantity(float(np.median(mean_temperature)), "degC", kind=EvidenceKind.MODEL, tier=AccessTier.LIVE if temp_spec["shift_c"] == 0 else AccessTier.MODELED,
                                                 datasets=["nasa_power"], low=float(np.percentile(mean_temperature, 10)), high=float(np.percentile(mean_temperature, 90)), period=WEATHER_PERIOD,
                                                 n_valid=len(gathered.climate.years), n_expected=len(gathered.climate.years), digits=1)}},
        "weights": [{"priority": priority, "score_id": score_id, "rank": farmer["priorities"].index(priority) + 1 if priority in farmer["priorities"] else None,
                     "weight": round(weights[score_id], 4)} for priority, score_id in config.PRIORITY_TO_SCORE.items()],
        "rotations": built, "field_evidence": evidence, "series": series, "comparisons": pairs, "zones": zone_summary,
        "uncertainty": {"method": f"{draws.n} weather years, the same for every rotation. Each draws a year from the {int(gathered.climate.years[0])} to {int(gathered.climate.years[-1])} record, a soil water-holding value from the survey's range, crop coefficients and planting dates from their published ranges, and one of the rainfall records.",
                        "n_runs": draws.n, "interval": config.INTERVAL[0], "seed": seed_hex[:16], "drivers": drivers(current, draws)},
        "gaps": gaps, "currency": {"code": gathered.currency.code, "name": gathered.currency.name}, "ranking_note": ranking_note, "close_call": close_call,
    }
    return analysis, zone_payload
