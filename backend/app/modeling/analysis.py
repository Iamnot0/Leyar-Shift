"""The operations the API exposes: coverage, the crop list and a full analysis."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

from app.adapters import cdl, faostat, gibs, meteomatics, pictures, places, weather
from app.adapters.base import Allowance, SourceState
from app.core import config
from app.core.config import get_settings
from app.core.provenance import DATASETS, NullReason
from app.fusion.grid import FieldError, build_grid, read_field
from app.modeling import crops, engine, rotations, simulate, summary
from app.modeling.engine import AnalysisError, Context
from app.modeling.report import consistency_quantity, observed_years


def analyze(request: dict[str, Any], ctx: Context, progress: Callable[[str], None]) -> tuple[dict, dict]:
    """Returns the Analysis document and its zone layers."""
    _, digest = engine.request_seed(request)
    gathered = engine.gather(request, ctx, progress)
    results, baseline, draws, weights, _ = engine.run_rotations(request, gathered, progress)
    return summary.build(request, gathered, results, baseline, draws, weights, digest, analysis_id(request), ctx.today.year)


def analysis_id(request: dict[str, Any]) -> str:
    """One id per request, engine build and set of connected sources: a stored result is reused only where it would come out the same."""
    settings = get_settings()
    connected = sorted(name for name in ("EARTHDATA_TOKEN", "OPENET_API_KEY", "METEOMATICS_USERNAME", "NASS_API_KEY", "OPENROUTER_API_KEY") if settings.key(name))
    return engine.request_digest({"request": request, "engine": config.engine_fingerprint(), "connected": connected, "imerg": settings.read_imerg})[:32]


def check_request(request: dict[str, Any], ctx: Context) -> places.Place:
    """The checks that must fail fast at POST time rather than inside a job."""
    try:
        polygon = read_field(request["field"]["geometry"])
        place = places.locate(ctx.fetcher, polygon.centroid.x, polygon.centroid.y)
        build_grid(request["field"]["geometry"], conterminous_us=place.conterminous_us)
    except FieldError as error:
        raise AnalysisError(error.error_type, "The field cannot be analysed", str(error)) from error
    entered = (request["farmer"].get("current_rotation") or {}).get("years")
    if not place.conterminous_us and not entered:
        raise AnalysisError("rotation_required", "Your rotation is needed",
                            "No crop history source covers this location: the national cropland map covers the United States only. Send farmer.current_rotation.")
    library = crops.load(crops.region_for(place.country_code, polygon.centroid.y, place.conterminous_us)[0])
    engine.validate_farmer_crops(request.get("farmer"), library)
    return place


def _dataset_rows(place: places.Place, lon: float, lat: float, ctx: Context) -> list[dict]:
    rows = []
    for spec in DATASETS.values():
        if spec.context_only or (spec.id == "soilgrids" and place.conterminous_us):
            continue
        footprint = period = as_of = None
        if not spec.configured or (spec.id == "openet" and not ctx.settings.key("OPENET_API_KEY")) or (spec.id in ("gpm_imerg", "gldas", "nldas", "grace_fo") and not ctx.settings.key("EARTHDATA_TOKEN")):
            state = SourceState.not_configured(spec.id)
        elif spec.scope.value != "global" and not place.conterminous_us:
            state = SourceState.out_of_coverage(spec.id, f"{spec.name} covers the United States only.")
        elif spec.id == "faostat":
            if place.conterminous_us:
                continue
            priced = faostat.currency(ctx.settings.processed_dir, place.country_m49) is not None
            state = SourceState.ok("faostat", as_of=faostat.built_on(ctx.settings.processed_dir)) if priced else SourceState.out_of_coverage(
                "faostat", "FAO holds no crop statistics for this country.")
        else:
            state = SourceState(spec.id)
        rows.append({"id": spec.id, "name": spec.name, "provider": spec.provider, "role": spec.role, "coverage_scope": spec.scope.value,
                     "status": state.status, "null_reason": state.null_reason.value if state.null_reason else None,
                     "retryable": state.null_reason is NullReason.FETCH_FAILED, "message": state.message,
                     "access_tier": spec.tier.value if state.available else None, "evidence_kind": spec.evidence_kind.value,
                     "native_resolution_m": spec.native_resolution_m, "footprint": footprint,
                     "period": None if period is None else {"start": period[0], "end": period[1]}, "as_of": as_of, "source_url": spec.source_url})
    return rows


def coverage(geometry: dict[str, Any], ctx: Context) -> dict:
    try:
        polygon = read_field(geometry)
        lon, lat = polygon.centroid.x, polygon.centroid.y
        place = places.locate(ctx.fetcher, lon, lat)
        grid = build_grid(geometry, conterminous_us=place.conterminous_us)
    except FieldError as error:
        raise AnalysisError(error.error_type, "The field cannot be analysed", str(error)) from error
    return {"field": _field_summary(grid, place, lon, lat), "datasets": _dataset_rows(place, lon, lat, ctx), "crop_history_available": place.conterminous_us}


def _field_summary(grid, place: places.Place, lon: float, lat: float) -> dict:
    return {"name": None, "area_ha": round(grid.area_ha, 2), "centroid": {"lat": round(lat, 5), "lon": round(lon, 5)},
            "country_code": place.country_code, "coverage_scopes": ["global"] + (["us_only"] if place.conterminous_us else []),
            "grid": {"crs": grid.crs, "cell_size_m": grid.cell_size, "n_cells": grid.n_cells}}


def crop_history(geometry: dict[str, Any], ctx: Context) -> dict:
    """The crop map's year-by-year reading of the field and the rotation read from it, for the farmer to confirm."""
    try:
        polygon = read_field(geometry)
        lon, lat = polygon.centroid.x, polygon.centroid.y
        place = places.locate(ctx.fetcher, lon, lat)
        grid = build_grid(geometry, conterminous_us=place.conterminous_us)
    except FieldError as error:
        raise AnalysisError(error.error_type, "The field cannot be analysed", str(error)) from error

    def answer(detected: dict | None, observed: list[dict], reason: NullReason | None, explanation: str | None) -> dict:
        return {"field": _field_summary(grid, place, lon, lat), "crop_history_available": place.conterminous_us, "detected": detected,
                "observed_years": observed, "null_reason": reason.value if reason else None, "null_explanation": explanation,
                "retryable": reason is NullReason.FETCH_FAILED}

    if not place.conterminous_us:
        return answer(None, [], NullReason.OUT_OF_COVERAGE, "No crop history source covers this location: the national cropland map covers the United States only. Enter your rotation.")
    library = crops.load("us")
    history, names, cells_read, state = cdl.field_history(ctx.fetcher, grid)
    if not state.available:
        return answer(None, [], state.null_reason, state.message)
    try:
        county = cdl.county_classes(ctx.fetcher, (place.state_fips or "") + (place.county_fips or ""), config.CROP_HISTORY_LAST_YEAR)
        names = {**{code: name for code, (name, _) in county.items()}, **names}
    except Exception:  # noqa: BLE001 - the point service already named the classes it returned
        pass
    baseline = rotations.detect_baseline(history, names, library, cells_read)
    if baseline is None:
        seen = rotations.observe(history, names, library, cells_read)
        rows = [{"year": row.year, "crop_id": row.crop_id, "class_name": row.class_name, "share_of_field": round(row.share, 3), "n_cells": row.n_cells} for row in seen]
        return answer(None, rows, NullReason.INSUFFICIENT, "The crop map shows too few years of a crop this tool handles on this field to read a rotation. Enter your rotation.")
    detected = {"years": [{"crop_id": year.crop.id, "cover_crop_id": None} for year in baseline.years], "label": rotations.label(baseline.years),
                "detection_basis": baseline.basis, "share_of_years_consistent": consistency_quantity(baseline)}
    return answer(detected, observed_years(baseline), None, None)


def layers(lat: float, lon: float, ctx: Context) -> dict:
    """Map layers for this place, sharpest picture first, then NASA's pictures, then data maps."""
    place = places.locate(ctx.fetcher, lon, lat)
    with ThreadPoolExecutor(max_workers=2) as pool:
        sharp_f = pool.submit(pictures.sharp_pictures, ctx.fetcher, lon, lat, conterminous_us=place.conterminous_us)
        nasa_f = pool.submit(gibs.layers_at, ctx.fetcher, lon, lat)
        sharp, nasa = sharp_f.result(), nasa_f.result()
    ordered = sharp + [layer for layer in nasa if layer["kind"] == "picture"] + [layer for layer in nasa if layer["kind"] == "data"]
    return {"location": {"lat": lat, "lon": lon}, "layers": ordered}


def forecast_days(lat: float, lon: float, ctx: Context) -> tuple[list[meteomatics.ForecastDay], str | None, SourceState]:
    return meteomatics.outlook(ctx.fetcher, ctx.settings.key("METEOMATICS_USERNAME"), ctx.settings.key("METEOMATICS_PASSWORD"),
                               lon, lat, first=ctx.today, days=config.OUTLOOK_DAYS,
                               allowance=Allowance(ctx.settings.records, "meteomatics", config.METEOMATICS_REQUESTS_PER_DAY, "day"))


def outlook(lat: float, lon: float, ctx: Context, fetched: tuple[list[meteomatics.ForecastDay], str | None, SourceState] | None = None) -> dict:
    """The forecast for the next days, or the reason there is none."""
    spec = DATASETS["meteomatics"]
    days, issued_at, state = fetched or forecast_days(lat, lon, ctx)
    return {"location": {"lat": lat, "lon": lon}, "available": state.available, "dataset_id": spec.id, "provider": spec.provider, "source_url": spec.source_url,
            "evidence_kind": spec.evidence_kind.value, "access_tier": spec.tier.value, "issued_at": issued_at,
            "days": [{"date": day.day.isoformat(), "t_max_c": round(day.t_max_c, 1), "t_min_c": round(day.t_min_c, 1), "rain_mm": round(day.rain_mm, 1),
                      "rain_chance": round(day.rain_chance, 2), "frost": day.t_min_c <= config.FROST_DAY_C, "heat": day.t_max_c >= config.HEAT_DAY_C} for day in days],
            "null_reason": state.null_reason.value if state.null_reason else None, "null_explanation": state.message,
            "retryable": state.null_reason is NullReason.FETCH_FAILED,
            "note": "A forecast, not a measurement. It is less sure with each day ahead, and it changes no figure in the comparison."}


def crop_list(lat: float, lon: float, ctx: Context) -> dict:
    place = places.locate(ctx.fetcher, lon, lat)
    region, exact = crops.region_for(place.country_code, lat, place.conterminous_us)
    library = crops.load(region)
    with ThreadPoolExecutor(max_workers=2) as pool:
        power_f = pool.submit(weather.fetch_power, ctx.fetcher, lon, lat)
        county_f = pool.submit(cdl.county_classes, ctx.fetcher, (place.state_fips or "") + (place.county_fips or ""),
                               config.CROP_HISTORY_LAST_YEAR) if place.conterminous_us else None
        record, _ = power_f.result()
        shares = None
        if county_f is not None:
            try:
                classes = county_f.result()
                cropland = sum(acres for name, acres in classes.values() if not name.startswith(rotations.NON_CROP_CLASSES))
                shares = {}
                for name, acres in classes.values():
                    crop_id = library.from_cdl(name)
                    if crop_id and cropland > 0:
                        shares[crop_id] = shares.get(crop_id, 0.0) + acres / cropland
            except Exception:  # noqa: BLE001 - the list is still useful without county shares
                shares = None
    gathered = None
    if record is not None:
        climate = simulate.prepare_climate(record)
        gathered = engine.Gathered(grid=None, place=place, region=region, region_exact=exact, library=library, states={}, record=record, climate=climate)  # type: ignore[arg-type]
        gathered.frost_free_days = engine.frost_free_days(climate)
    out = []
    for crop in library.crops.values():
        suitable, reason = engine.suitability(crop, gathered) if gathered is not None else (None, "The weather record could not be loaded, so the season cannot be checked.")
        if suitable and not exact:
            suitable, reason = None, "No crop calendar is set up for this part of the world, so suitability here is not judged."
        local = None if shares is None or crop.category in ("cover", "fallow") else shares.get(crop.id, 0.0) >= config.LOCALLY_GROWN_MIN_SHARE
        out.append({"id": crop.id, "name": crop.name, "category": crop.category, "family": " and ".join(sorted(set(crop.families))) or None,
                    "nitrogen_fixing": crop.nitrogen_fixing, "rooting_depth": crops.rooting_class(crop), "water_demand": crops.water_demand_class(crop),
                    "equipment": list(crop.equipment), "suitable": suitable, "suitability_reason": reason, "grown_locally": local})
    return {"location": {"lat": lat, "lon": lon}, "crop_history_available": place.conterminous_us, "crops": out}
