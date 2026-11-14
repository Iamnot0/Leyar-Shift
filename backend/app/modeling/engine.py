"""Gathers every source for one field and runs the rotations through them."""

from __future__ import annotations

import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Callable

import numpy as np

from app.adapters import cdl, faostat, groundwater, imerg, nass, openet, places, raster, soil, weather
from app.adapters.base import Allowance, Fetcher, SourceState
from app.core import config
from app.core.config import Settings
from app.core.provenance import EQUIPMENT_LABELS

IMERG_NOT_READ = ("IMERG monthly rainfall takes several minutes to read for a new place, longer than this site's server allows. "
                  "Rainfall comes from NASA POWER and ERA5.")
from app.fusion.grid import FieldError, Grid, build_grid, read_field
from app.modeling import crops, rotations, simulate
from app.modeling.crops import Crop, CropLibrary
from app.modeling.simulate import Climate, Draws, RotationYear, SimResult

SCREEN_DRAWS = 60
MID_SEASON_MIN_MEAN_C = 10.0
MIN_ALTERNATIVES = 2


class AnalysisError(Exception):
    """The analysis cannot produce a result. Carries the stable error type the contract lists."""

    def __init__(self, error_type: str, title: str, detail: str, status: int = 422) -> None:
        super().__init__(detail)
        self.error_type, self.title, self.detail, self.status = error_type, title, detail, status


@dataclass
class Context:
    settings: Settings
    fetcher: Fetcher
    today: date


@dataclass
class Revenue:
    """What one crop brought in per hectare in each of some past years, before costs, in the analysis's currency."""

    yearly: np.ndarray
    years: list[int]
    yields: nass.Reported
    prices: nass.Reported
    # The source of the records, or None when the farmer entered the figures.
    dataset_id: str | None = "nass_quickstats"


@dataclass
class Gathered:
    grid: Grid
    place: places.Place
    region: str
    region_exact: bool
    library: CropLibrary
    states: dict[str, SourceState]
    record: weather.WeatherRecord
    climate: Climate
    soil: soil.SoilProfile | None = None
    elevation: np.ndarray | None = None
    slope_percent: np.ndarray | None = None
    history: dict[int, dict[int, float]] = field(default_factory=dict)
    class_names: dict[int, str] = field(default_factory=dict)
    cells_read: dict[int, int] = field(default_factory=dict)
    county_shares: dict[str, float] | None = None
    revenue: dict[str, Revenue] = field(default_factory=dict)
    # Why a crop has no money figure, by crop.
    revenue_gaps: dict[str, str] = field(default_factory=dict)
    currency: faostat.Currency = faostat.Currency("USD", "US dollars")
    scenes: list[raster.NdviScene] = field(default_factory=list)
    greenness: list[raster.NdviScene] = field(default_factory=list)
    openet: dict[str, float] = field(default_factory=dict)
    imerg: dict[str, float] = field(default_factory=dict)
    pass_days: list[date] = field(default_factory=list)
    wells: groundwater.WellTrend | None = None
    frost_free_days: float = 0.0


@dataclass
class Evaluated:
    id: str
    role: str
    change_level: str
    note: str
    years: list[RotationYear]
    sim: SimResult
    scores: dict[str, np.ndarray | None]
    revenue: np.ndarray | None
    family_run: int | None
    overall: np.ndarray | None = None


def request_digest(request: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(request, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def request_seed(request: dict[str, Any]) -> tuple[int, str]:
    """The seed for the runs. Confirming a rotation is not an input to them, so it must not move any number."""
    farmer = {key: value for key, value in request["farmer"].items() if key != "current_rotation_confirmed"}
    digest = request_digest({**request, "farmer": farmer})
    return int(digest[:16], 16), digest


def weights_for(priorities: list[str]) -> dict[str, float]:
    """Rank-order-centroid weights: the first priority counts most, unranked scores count nothing."""
    count = len(priorities)
    ranked = {config.PRIORITY_TO_SCORE[p]: sum(1.0 / k for k in range(i + 1, count + 1)) / count for i, p in enumerate(priorities)}
    return {score: ranked.get(score, 0.0) for score in config.SCORE_ORDER}


def frost_free_days(climate: Climate) -> float:
    """Median days between the last spring frost and the first autumn frost."""
    cold = climate.tmin <= config.FROST_DAY_C
    spring = np.where(cold[:, :182].any(axis=1), 182 - np.argmax(cold[:, :182][:, ::-1], axis=1), 0)
    autumn = np.where(cold[:, 182:].any(axis=1), 182 + np.argmax(cold[:, 182:], axis=1), 365)
    return float(np.median(autumn - spring))


def _smooth(elevation: np.ndarray, radius: int = 2) -> np.ndarray:
    """Box average. The elevation source is in whole metres, and its one-metre steps would read as slopes."""
    padded = np.pad(elevation, radius, mode="edge")
    size = 2 * radius + 1
    total = np.zeros_like(elevation, dtype=float)
    for dy in range(size):
        for dx in range(size):
            total += padded[dy:dy + elevation.shape[0], dx:dx + elevation.shape[1]]
    return total / size**2


def validate_farmer_crops(farmer: dict[str, Any] | None, library: CropLibrary) -> None:
    """Reject unknown or non-single-crop farmer entries before queuing or downloading data."""
    farmer = farmer or {}
    single = {crop.phases[0].id for crop in library.crops.values() if len(crop.phases) == 1 and (crop.phases[0].stages or crop.phases[0].perennial)}
    for entry in farmer.get("own_figures") or []:
        if entry["crop_id"] not in single:
            raise AnalysisError(
                "unknown_crop",
                "Unknown crop",
                f"'{entry['crop_id']}' in your own figures is not a single crop this tool handles at this location. GET /v1/crops lists the accepted crops.",
            )
    entered = (farmer.get("current_rotation") or {}).get("years")
    if entered:
        _, unknown = rotations.from_farmer(entered, library)
        if unknown is not None:
            raise AnalysisError(
                "unknown_crop",
                "Unknown crop",
                f"'{unknown}' is not a crop this tool handles at this location. GET /v1/crops lists the accepted crops.",
            )


def gather(request: dict[str, Any], ctx: Context, progress: Callable[[str], None]) -> Gathered:
    fetcher, settings = ctx.fetcher, ctx.settings
    progress("reading_field")
    try:
        polygon = read_field(request["field"]["geometry"])
        lon, lat = polygon.centroid.x, polygon.centroid.y
        place = places.locate(fetcher, lon, lat)
        grid = build_grid(request["field"]["geometry"], conterminous_us=place.conterminous_us)
    except FieldError as error:
        raise AnalysisError(error.error_type, "The field cannot be analysed", str(error)) from error

    progress("checking_coverage")
    region, exact = crops.region_for(place.country_code, lat, place.conterminous_us)
    library = crops.load(region)
    validate_farmer_crops(request.get("farmer"), library)
    states: dict[str, SourceState] = {}

    def fetch_weather() -> tuple[weather.WeatherRecord | None, SourceState, np.ndarray | None, SourceState | None]:
        record, power_state = weather.fetch_power(fetcher, lon, lat)
        if record is None:
            return None, power_state, None, None
        rain_alt, era5_state = weather.fetch_era5_rain(fetcher, lon, lat, record.dates)
        return record, power_state, rain_alt, era5_state

    progress("fetching_weather")
    # The weather comes first and alone: it decides whether any crop can grow here, and a place where none can
    # is turned away before two minutes of satellite reads are spent on it.
    record, states["nasa_power"], rain_alt, era5_state = fetch_weather()
    if record is None:
        raise AnalysisError("weather_unavailable", "No weather record", states["nasa_power"].message or "The weather record could not be loaded.", 503)
    if era5_state is not None:
        record.rain_alt, states["era5_open_meteo"] = rain_alt, era5_state
    shift = config.TEMPERATURE_SCENARIOS[(request.get("scenario") or {}).get("temperature", "normal")]["shift_c"]
    climate = simulate.prepare_climate(record, shift)
    gathered = Gathered(grid=grid, place=place, region=region, region_exact=exact, library=library, states=states, record=record, climate=climate)
    gathered.frost_free_days = frost_free_days(climate)
    # In the United States the state's own planting dates replace the table's further on, so the check waits for them there.
    if not place.conterminous_us and not any(suitability(crop, gathered)[0] for crop in library.crops.values() if crop.category in ("cash", "forage")):
        raise AnalysisError("insufficient_candidates", "No crop fits this place",
                            "The weather record here is too hot, too cold or too short in season for every crop this tool handles, so there is nothing to compare. "
                            "Check that the field is marked in the right place.")
    county = (place.state_fips or "") + (place.county_fips or "")
    token = settings.key("EARTHDATA_TOKEN")
    openet_key = settings.key("OPENET_API_KEY")
    with ThreadPoolExecutor(max_workers=12) as pool:
        imerg_f = (pool.submit(imerg.monthly_rain, fetcher, token, lon, lat, today=ctx.today) if settings.read_imerg
                   else pool.submit(lambda: ({}, SourceState.not_configured("gpm_imerg", IMERG_NOT_READ))))
        soil_f = pool.submit(soil.fetch_ssurgo, fetcher, grid) if place.conterminous_us else pool.submit(soil.fetch_soilgrids, fetcher, lon, lat)
        elev_f = pool.submit(raster.elevation, fetcher, grid)
        cdl_hist_f = pool.submit(cdl.field_history, fetcher, grid) if place.conterminous_us else None
        cdl_county_f = pool.submit(cdl.county_classes, fetcher, county, config.CROP_HISTORY_LAST_YEAR) if place.conterminous_us else None
        nass_f = pool.submit(_fetch_nass, place, library, ctx) if place.conterminous_us else None
        s2_f = pool.submit(raster.ndvi_scenes, fetcher, grid, today=ctx.today)
        modis_f = pool.submit(raster.greenness_history, fetcher, grid, today=ctx.today)
        openet_f = pool.submit(openet.monthly_water_use, fetcher, openet_key, grid, today=ctx.today, allowance=Allowance(
            settings.records, "openet", config.OPENET_REQUESTS_PER_MONTH, "month")) if place.conterminous_us else None
        wells_f = pool.submit(groundwater.fetch_well_trend, fetcher, lon, lat, since=2000) if place.conterminous_us else None

        gathered.imerg, states["gpm_imerg"] = imerg_f.result()

        progress("fetching_soil")
        if place.conterminous_us:
            gathered.soil, states["ssurgo"] = soil_f.result()
        else:
            gathered.soil, states["soilgrids"] = soil_f.result()
        gathered.elevation, states["nasadem"] = elev_f.result()
        if gathered.elevation is not None and min(grid.shape) >= 2:
            dy, dx = np.gradient(_smooth(gathered.elevation), grid.cell_size)
            gathered.slope_percent = 100.0 * np.hypot(dx, dy)

        progress("fetching_crop_history")
        if place.conterminous_us:
            assert cdl_hist_f is not None and cdl_county_f is not None and nass_f is not None
            gathered.history, names, gathered.cells_read, states["usda_cdl"] = cdl_hist_f.result()
            gathered.class_names = dict(names)
            try:
                classes = cdl_county_f.result()
                gathered.class_names.update({code: name for code, (name, _) in classes.items()})
                cropland = sum(acres for name, acres in classes.values() if not name.startswith(rotations.NON_CROP_CLASSES))
                shares: dict[str, float] = {}
                for name, acres in classes.values():
                    crop_id = library.from_cdl(name)
                    if crop_id and cropland > 0:
                        shares[crop_id] = shares.get(crop_id, 0.0) + acres / cropland
                gathered.county_shares = shares
            except Exception:  # noqa: BLE001 - county statistics are optional context
                gathered.county_shares = None
            _apply_nass(gathered, *nass_f.result())

        progress("fetching_vegetation")
        gathered.scenes, gathered.pass_days, states["sentinel2"] = s2_f.result()
        gathered.greenness, states["modis_vegetation"] = modis_f.result()

        progress("fetching_water")
        if place.conterminous_us:
            assert openet_f is not None and wells_f is not None
            gathered.openet, states["openet"] = openet_f.result()
            gathered.wells, states["usgs_groundwater"] = wells_f.result()

    if not place.conterminous_us:
        _load_country_income(gathered, ctx)
    _apply_own_figures(gathered, request, ctx)
    for dataset_id, state in states.items():
        if state.available and state.as_of is None:
            state.as_of = fetcher.latest(dataset_id)
    return gathered


def _load_country_income(gathered: Gathered, ctx: Context) -> None:
    """Outside the United States: each crop's national yield and farm price as reported to FAO, in the country's own currency."""
    processed, m49 = ctx.settings.processed_dir, gathered.place.country_m49
    gathered.currency = faostat.currency(processed, m49) or gathered.currency
    found = 0
    for crop in gathered.library.crops.values():
        if len(crop.phases) != 1 or not crop.phases[0].fao_item:
            continue
        phase = crop.phases[0]
        reported, why_not = faostat.income(processed, m49, phase.fao_item, this_year=ctx.today.year)
        if reported is None:
            gathered.revenue_gaps[phase.id] = why_not or "No income records."
            continue
        yearly = np.array([reported.yields.values[year] * reported.prices.values[year] for year in reported.years])
        gathered.revenue[phase.id] = Revenue(yearly, reported.years, reported.yields, reported.prices, "faostat")
        found += 1
    if found:
        years = sorted({year for revenue in gathered.revenue.values() for year in revenue.years})
        gathered.states["faostat"] = SourceState.ok("faostat", as_of=faostat.built_on(processed), period=(f"{years[0]}-01-01", f"{years[-1]}-12-31"))
    else:
        reasons = sorted(set(gathered.revenue_gaps.values()))
        gathered.states["faostat"] = SourceState.insufficient("faostat", reasons[0] if len(reasons) == 1 else "FAO holds no recent farm prices for the crops this tool handles in this country.")


def _apply_own_figures(gathered: Gathered, request: dict[str, Any], ctx: Context) -> None:
    """A farmer's own yield and price for a crop replace any published record for it."""
    for entry in (request.get("farmer") or {}).get("own_figures") or []:
        crop_yield, price = float(entry["yield_t_per_ha"]), float(entry["price_per_tonne"])
        year = ctx.today.year
        gathered.revenue[entry["crop_id"]] = Revenue(np.array([crop_yield * price]), [year], nass.Reported({year: crop_yield}, "t/ha", "your own"),
                                                     nass.Reported({year: price}, f"{gathered.currency.code}/t", "your own"), None)
        gathered.revenue_gaps.pop(entry["crop_id"], None)


def _fetch_nass_for_phase(fetcher: Fetcher, key: str, place: places.Place, phase: Any
                          ) -> tuple[str, tuple | None, tuple | None, Revenue | None, Exception | None]:
    try:
        commodity, class_desc, util = phase.nass
        planted = harvested = None
        if phase.stages:
            progress_commodity = nass.Commodity(commodity, class_desc if commodity == "WHEAT" else "ALL CLASSES")
            planted = nass.progress_day(fetcher, key, progress_commodity, "PCT PLANTED", place.state_fips)
            harvested = nass.progress_day(fetcher, key, progress_commodity, "PCT HARVESTED", place.state_fips)
        named = nass.Commodity(commodity, class_desc, util)
        reported_price = nass.prices(fetcher, key, named, place.state_fips)
        revenue_item = None
        # County yields are used when at least three of their years also have a price; otherwise the state's.
        for reported_yield in nass.yields(fetcher, key, named, place.state_fips, place.county_fips) if reported_price else []:
            common = sorted(set(reported_yield.values) & set(reported_price.values))
            yearly = [nass.revenue_per_hectare(named, reported_yield.values[y], reported_yield.unit, reported_price.values[y], reported_price.unit) for y in common]
            if len(common) >= 3 and all(value is not None for value in yearly):
                revenue_item = Revenue(np.array(yearly, dtype=float), common, reported_yield, reported_price)
                break
        return phase.id, planted, harvested, revenue_item, None
    except Exception as error:  # noqa: BLE001 - one missing crop must not discard the others
        return phase.id, None, None, None, error


def _fetch_nass(place: places.Place, library: CropLibrary, ctx: Context) -> tuple[list[tuple[str, bool, tuple | None, tuple | None, Revenue | None, Exception | None]], SourceState | None]:
    key = ctx.settings.key("NASS_API_KEY")
    if not key:
        return [], SourceState.not_configured("nass_quickstats", "No NASS QuickStats key is set, so there are no yield, price or planting-date records.")
    phases = [crop.phases[0] for crop in library.crops.values() if len(crop.phases) == 1 and crop.phases[0].nass is not None]
    if not phases:
        return [], None
    with ThreadPoolExecutor(max_workers=min(len(phases), 10)) as pool:
        fetched = list(pool.map(lambda phase: _fetch_nass_for_phase(ctx.fetcher, key, place, phase), phases))
    rows = [(phase_id, bool(phase.stages), planted, harvested, revenue_item, error)
            for phase, (phase_id, planted, harvested, revenue_item, error) in zip(phases, fetched)]
    return rows, None


def _apply_nass(gathered: Gathered, rows: list[tuple[str, bool, tuple | None, tuple | None, Revenue | None, Exception | None]], error_state: SourceState | None) -> None:
    if error_state is not None:
        gathered.states["nass_quickstats"] = error_state
        return
    found = 0
    first_error: Exception | None = None
    for phase_id, has_stages, planted, harvested, revenue_item, error in rows:
        if error is not None and first_error is None:
            first_error = error
        if planted and harvested and has_stages:
            season = int(round((harvested[0] - planted[0]) % 365))
            if 60 <= season <= 340:
                gathered.library.with_calendar(phase_id, plant_doy=int(round(planted[0])) % 365 or 1, season_days=season,
                                               spread=(int(round(planted[1] - planted[0])), int(round(planted[2] - planted[0]))),
                                               note=f"Planting and harvest dates are the state's reported medians since 2015 ({planted[3]} seasons).")
                found += 1
        if revenue_item is not None:
            gathered.revenue[phase_id] = revenue_item
            found += 1
    if found:
        gathered.states["nass_quickstats"] = SourceState.ok("nass_quickstats")
    elif first_error is not None:
        gathered.states["nass_quickstats"] = SourceState.failed("nass_quickstats", first_error)
    else:
        gathered.states["nass_quickstats"] = SourceState.insufficient(
            "nass_quickstats", "NASS QuickStats has no usable yield, price or planting-date records for this county.")


def _load_nass(gathered: Gathered, ctx: Context) -> None:
    rows, error_state = _fetch_nass(gathered.place, gathered.library, ctx)
    _apply_nass(gathered, rows, error_state)


def suitability(crop: Crop, gathered: Gathered) -> tuple[bool | None, str]:
    """A climate screen only: is the season long and warm enough for each phase of the crop."""
    if crop.category in ("fallow", "cover"):
        return True, "Can be used anywhere."
    climate = gathered.climate
    mean = (climate.tmax + climate.tmin).mean(axis=0) / 2
    for phase in crop.phases:
        if phase.perennial:
            season = float(np.median(climate.growing_end - climate.growing_start))
            if season < 120:
                return False, f"The season between hard frosts is about {season:.0f} days, too short for {phase.name.lower()}."
            continue
        if not phase.stages or phase.plant_doy is None:
            return None, "No growing calendar is available for this crop here."
        start = phase.plant_doy - 1 + phase.stages[0] + phase.stages[1]
        window = np.arange(start, start + phase.stages[2]) % 365
        warmth = float(mean[window].mean())
        if warmth < MID_SEASON_MIN_MEAN_C:
            return False, f"The weeks when {phase.name.lower()} would fill grain average {warmth:.0f} °C here, too cold for it."
        if phase.spring_planted and gathered.frost_free_days < 364 and phase.frost_sensitive_days > gathered.frost_free_days + config.CROP_FIT_SEASON_MARGIN_DAYS:
            return False, f"{phase.name} needs about {phase.frost_sensitive_days} frost-free days from sowing until it starts to ripen; the frost-free season here is about {gathered.frost_free_days:.0f}."
    return True, "The season is long and warm enough in most years."


def _typical_revenue(years: list[RotationYear], gathered: Gathered) -> float | None:
    """Mean yearly revenue of a rotation from the records, or None when a crop in it has none."""
    phases = [phase for year in years for phase in year.crop.phases if phase.stages or phase.perennial]
    if any(phase.id not in gathered.revenue for phase in phases):
        return None
    return sum(float(gathered.revenue[phase.id].yearly.mean()) for phase in phases) / len(years)


def _revenue_draws(years: list[RotationYear], gathered: Gathered, draws: Draws) -> np.ndarray | None:
    total = np.zeros(draws.n)
    for year in years:
        for phase in year.crop.phases:
            if not (phase.stages or phase.perennial):
                continue
            revenue = gathered.revenue.get(phase.id)
            if revenue is None:
                return None
            total += revenue.yearly[np.minimum((draws.revenue_r * len(revenue.yearly)).astype(int), len(revenue.yearly) - 1)]
    return total / len(years)


def _linear(values: np.ndarray, best: float, worst: float) -> np.ndarray:
    return 100.0 * np.clip((worst - values) / (worst - best), 0.0, 1.0)


def _evaluate_sim(identifier: str, role: str, level: str, note: str, years: list[RotationYear], gathered: Gathered,
                  draws: Draws, revenue_reference: float | None, sim: SimResult) -> Evaluated:
    anchors = config.SCORE_ANCHORS
    phases = [phase for year in years for phase in year.crop.phases if phase.stages or phase.perennial]
    families = {phase.family for phase in phases if phase.family}
    legume_share = sum(phase.nitrogen_fixing for phase in phases) / len(phases) if phases else 0.0
    soil_health = 100.0 * (sim.living_weeks / 52.0 + sim.covered_weeks / 52.0 + min(1.0, 2.0 * legume_share) + min(1.0, max(len(families) - 1, 0) / 2.0)) / 4.0
    family_run = rotations.longest_family_run(years)
    revenue = _revenue_draws(years, gathered, draws)
    scores: dict[str, np.ndarray | None] = {
        "water_balance": None if sim.water_need is None else _linear(sim.water_need, anchors["water_balance"]["best"], anchors["water_balance"]["worst"]),
        "soil_health": np.clip(soil_health, 0.0, 100.0),
        "erosion": _linear(sim.bare_wet_weeks, anchors["erosion"]["best"], anchors["erosion"]["worst"]),
        "climate_risk": _linear(sim.heat_days + sim.frost_days, anchors["climate_risk"]["best"], anchors["climate_risk"]["worst"]),
        "pest_break": None if family_run is None else np.full(draws.n, float(_linear(np.array([float(family_run)]), anchors["pest_break"]["best"], anchors["pest_break"]["worst"])[0])),
        "economics": None if revenue is None or not revenue_reference else np.clip(100.0 * revenue / revenue_reference, 0.0, 100.0),
    }
    return Evaluated(identifier, role, level, note, years, sim, scores, revenue, family_run)


def evaluate(identifier: str, role: str, level: str, note: str, years: list[RotationYear], gathered: Gathered, draws: Draws,
             revenue_reference: float | None) -> Evaluated:
    awc = gathered.soil.awc_mm_per_m if gathered.soil is not None else None
    sim = simulate.simulate(years, gathered.climate, draws, awc)
    return _evaluate_sim(identifier, role, level, note, years, gathered, draws, revenue_reference, sim)


def overall(evaluated: Evaluated, weights: dict[str, float]) -> np.ndarray | None:
    usable = {name: values for name, values in evaluated.scores.items() if values is not None}
    if not usable:
        return None
    chosen = {name: weights[name] for name in usable if weights[name] > 0} or {name: 1.0 for name in usable}
    total = sum(chosen.values())
    return sum(usable[name] * weight for name, weight in chosen.items()) / total


def _subset(draws: Draws, count: int) -> Draws:
    count = min(count, draws.n)
    return Draws(n=count, year_index=draws.year_index[:count], soil_u=draws.soil_u[:count], crop_v=draws.crop_v[:count],
                 plant_z=draws.plant_z[:count], use_alt_rain=draws.use_alt_rain[:count], revenue_r=draws.revenue_r[:count])


def listed(words: list[str]) -> str:
    return words[0] if len(words) == 1 else ", ".join(words[:-1]) + " and " + words[-1]


def _why_nothing_fits(library: CropLibrary, screen: dict[str, tuple[bool | None, str]], farmer: dict[str, Any], gathered: Gathered) -> str:
    """Names the one answer that removed every crop, so the farmer knows what to change."""
    growable = [crop for crop in library.crops.values() if crop.category in ("cash", "forage") and len(crop.phases) == 1 and screen[crop.id][0] is True]
    if not growable:
        return ("The weather record here is too hot, too cold or too short in season for every crop this tool handles, so there is nothing to compare. "
                "Check that the field is marked in the right place.")
    excluded = set(farmer.get("excluded_crop_ids") or [])
    allowed = [crop for crop in growable if crop.id not in excluded]
    if not allowed:
        return f"Every crop that can grow here was ruled out: {listed([crop.name.lower() for crop in growable])}. Allow at least one of them."
    equipment = farmer.get("equipment")
    if equipment is not None and not any(set(crop.equipment) <= set(equipment) for crop in allowed):
        labels = {equipment_id: label.lower() for equipment_id, label, _ in EQUIPMENT_LABELS}
        by_need: dict[tuple[str, ...], list[str]] = {}
        for crop in allowed:
            by_need.setdefault(tuple(item for item in labels if item in crop.equipment), []).append(crop.name.lower())
        needs = "; ".join(f"{listed(names)} ({listed([labels[item] for item in need])})" for need, names in sorted(by_need.items(), key=lambda entry: -len(entry[1])))
        have = "no equipment" if not equipment else f"only {listed([labels[item] for item in labels if item in equipment])}"
        return (f"You listed {have}. Every crop that can grow here needs machines that are not on that list: {needs}. "
                "Add the machines you can own, hire or borrow, or say you are not sure, and the comparison will run without this limit.")
    return ("You asked only for crops already grown near you, and the county records show none of the crops that fit your equipment. "
            "Turn that limit off to compare.")


def run_rotations(request: dict[str, Any], gathered: Gathered, progress: Callable[[str], None]) -> tuple[list[Evaluated], rotations.Baseline, Draws, dict[str, float], dict[str, tuple[bool | None, str]]]:
    farmer = request["farmer"]
    library = gathered.library
    progress("building_rotations")
    entered = (farmer.get("current_rotation") or {}).get("years")
    if entered:
        years, unknown = rotations.from_farmer(entered, library)
        if years is None:
            raise AnalysisError("unknown_crop", "Unknown crop", f"'{unknown}' is not a crop this tool handles at this location. GET /v1/crops lists the accepted crops.")
        baseline = rotations.Baseline(years, "farmer_supplied", None, [], True)
    else:
        detected = rotations.detect_baseline(gathered.history, gathered.class_names, library, gathered.cells_read) if gathered.history else None
        if detected is None:
            raise AnalysisError("rotation_required", "Your rotation is needed",
                                "No crop history source covers this field well enough to read the rotation, so the request must include farmer.current_rotation.")
        baseline = detected

    screen = {crop.id: suitability(crop, gathered) for crop in library.crops.values()}
    excluded = set(farmer.get("excluded_crop_ids") or [])
    equipment = farmer.get("equipment")
    suitable = []
    for crop in library.crops.values():
        if crop.id in excluded or screen[crop.id][0] is not True:
            continue
        if equipment is not None and not set(crop.equipment) <= set(equipment):
            continue
        if farmer.get("local_market_only") and gathered.county_shares is not None and gathered.county_shares.get(crop.id, 0.0) < config.LOCALLY_GROWN_MIN_SHARE and crop.category == "cash":
            continue
        suitable.append(crop)
    if not any(crop.category in ("cash", "forage") for crop in suitable):
        raise AnalysisError("insufficient_candidates", "No crop fits this field", _why_nothing_fits(library, screen, farmer, gathered))
    cover = library.crops["cover_crop"].phases[0] if "cover_crop" in library.crops and (equipment is None or "grain_drill" in equipment) else None
    # A fallow year is a known practice on the US plains; it is not offered where the crop calendar is only a fallback.
    candidates = rotations.build_candidates(baseline.years, suitable, cover, allow_fallow=gathered.place.conterminous_us,
                                            require_forage=bool(farmer.get("require_forage")))

    seed, _ = request_seed(request)
    rainfall = (request.get("scenario") or {}).get("rainfall", "normal")
    draws = simulate.make_draws(seed, gathered.climate, rainfall)
    weights = weights_for(farmer["priorities"])
    # Income is scored against the best-earning rotation on offer here, so growing two crops a year counts for what it earns.
    earning = [_typical_revenue(years, gathered) for years in [baseline.years] + [candidate.years for candidate in candidates]]
    reference = max((value for value in earning if value), default=None)

    progress("scoring")
    screening = _subset(draws, SCREEN_DRAWS)
    awc = gathered.soil.awc_mm_per_m if gathered.soil is not None else None
    sims = simulate.simulate_batch([candidate.years for candidate in candidates], gathered.climate, screening, awc)
    ranked = []
    for candidate, sim in zip(candidates, sims):
        trial = _evaluate_sim("trial", "alternative", candidate.change_level, candidate.note, candidate.years, gathered, screening, reference, sim)
        if not trial.sim.fits:
            continue
        total = overall(trial, weights)
        if total is not None:
            # A rotation with a score missing must not outrank one that has it only because the gap is ignored.
            complete = all(trial.scores[name] is not None for name, weight in weights.items() if weight > 0)
            ranked.append((complete, float(np.mean(total)), candidate))
    ranked.sort(key=lambda item: (not item[0], -item[1]))
    chosen = []
    for level in ("low", "high"):
        pick = next((candidate for _, _, candidate in ranked if candidate.change_level == level and candidate not in chosen), None)
        if pick is not None:
            chosen.append(pick)
    for _, _, candidate in ranked:
        if len(chosen) >= MIN_ALTERNATIVES:
            break
        if candidate not in chosen:
            chosen.append(candidate)
    if len(chosen) < MIN_ALTERNATIVES:
        raise AnalysisError("insufficient_candidates", "Too few rotations to compare",
                            f"Only {len(chosen)} alternative rotation can be grown at this field under the season, equipment and market limits given. At least {MIN_ALTERNATIVES} are needed for a comparison.")

    progress("quantifying_uncertainty")
    final_rotations = [baseline.years] + [candidate.years for candidate in chosen]
    final_sims = simulate.simulate_batch(final_rotations, gathered.climate, draws, awc)
    results = [_evaluate_sim("current", "current", "none", "The rotation on this field now.", baseline.years, gathered, draws, reference, final_sims[0])]
    for index, (candidate, sim) in enumerate(zip(chosen, final_sims[1:]), start=1):
        results.append(_evaluate_sim(f"alternative-{index}", "alternative", candidate.change_level, candidate.note, candidate.years, gathered, draws, reference, sim))
    for result in results:
        result.overall = overall(result, weights)
    return results, baseline, draws, weights, screen
