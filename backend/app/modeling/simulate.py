"""Runs one rotation through the weather record: daily ground cover, a soil water budget and hazard counts.

Every rotation is run on the same draws, so two rotations can be compared run by run.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from app.adapters.weather import WeatherRecord
from app.core import config
from app.modeling import et0
from app.modeling.crops import COVER_END_BEFORE_PLANTING_DAYS, FALLOW_EVAPORATION_RANGE, TURNAROUND_DAYS, Crop, Phase

DAYS = 365
_MONTH_DAYS = (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
MONTH_OF_DAY = np.repeat(np.arange(1, 13), _MONTH_DAYS)
_MONTH_ENDS = np.cumsum(_MONTH_DAYS)
_MONTH_STARTS = _MONTH_ENDS - np.array(_MONTH_DAYS)
_MONTH_BOUNDS: tuple[tuple[int, int], ...] = tuple(zip(_MONTH_STARTS.tolist(), _MONTH_ENDS.tolist()))
BARE, RESIDUE, COVER, CROP = 0, 1, 2, 3
STATE_NAMES = ("bare", "residue", "cover_crop", "crop")
HAZARDS = ("frost", "heat", "dry_spell", "extreme_rain", "bare_field")
ROOT_START_M = 0.15
PROFILE_DEPTH_M = 1.5
SOIL_LAYERS = 6
LAYER_M = PROFILE_DEPTH_M / SOIL_LAYERS
MIN_COVER_WINDOW_DAYS = 45
# FAO-56 takes the soil layer that dries by evaporation as 0.10 to 0.15 m deep.
EVAPORATION_LAYER_M = 0.10
HEAT_MONTH_DAYS = 5
DRY_SPELL_DAYS = 14
ALFALFA_KILL_C = -4.0


@dataclass
class Climate:
    years: np.ndarray
    tmax: np.ndarray
    tmin: np.ndarray
    rain: np.ndarray
    et0: np.ndarray
    wind: np.ndarray
    rain_alt: np.ndarray | None
    annual_rain: np.ndarray
    wettest_months: tuple[int, ...]
    windiest_months: tuple[int, ...]
    heavy_rain_mm: float
    growing_start: np.ndarray
    growing_end: np.ndarray


@dataclass
class Draws:
    """The shared random inputs. Row i of every array belongs to run i."""

    n: int
    year_index: np.ndarray
    soil_u: np.ndarray
    crop_v: np.ndarray
    plant_z: np.ndarray
    use_alt_rain: np.ndarray
    revenue_r: np.ndarray


@dataclass
class RotationYear:
    crop: Crop
    cover: Phase | None = None


@dataclass
class PhaseTiming:
    phase: Phase
    cycle_year: int
    plant_doy: float
    harvest_doy: float
    delayed_days: float


@dataclass
class Seasons:
    """Every season of one crop across the runs, one entry per season, with the weather year it is harvested in."""

    weather_year: np.ndarray
    # Which of the crop's seasons in the cycle it is, for a crop grown more than once, such as wet- and dry-season rice.
    slot: np.ndarray
    killing_frost: np.ndarray
    flowering_heat_spell: np.ndarray
    full_use: np.ndarray
    water_need: np.ndarray | None


@dataclass
class PhaseStats:
    """One crop's own season within the rotation, per time it is grown."""

    phase: Phase
    heat_days: np.ndarray
    frost_share: float
    full_use: np.ndarray
    water_need: np.ndarray | None
    seasons: Seasons


@dataclass
class SimResult:
    cycle_years: int
    water_need: np.ndarray | None
    bare_weeks: np.ndarray
    living_weeks: np.ndarray
    covered_weeks: np.ndarray
    bare_wet_weeks: np.ndarray
    bare_windy_weeks: np.ndarray
    heat_days: np.ndarray
    frost_days: np.ndarray
    dry_spell_days: np.ndarray
    cover_month: np.ndarray
    crop_month: list[list[str | None]]
    hazard_month: np.ndarray
    timings: list[PhaseTiming] = field(default_factory=list)
    fits: bool = True
    balance_residual: np.ndarray | None = None
    # Water leaving the field in a year by crop use and bare-soil evaporation, with the crops kept watered.
    annual_use: np.ndarray | None = None
    by_phase: dict[str, PhaseStats] = field(default_factory=dict)


def _year_matrix(dates: np.ndarray, values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Stack a daily series into (years, 365), dropping 29 February and filling gaps with the day's own average."""
    months = dates.astype("datetime64[M]").astype(int) % 12 + 1
    days = (dates - dates.astype("datetime64[M]")).astype(int) + 1
    keep = ~((months == 2) & (days == 29))
    years = dates.astype("datetime64[Y]").astype(int)[keep] + 1970
    unique = np.unique(years)
    matrix = values[keep].reshape(len(unique), DAYS).astype(float)
    typical = np.nanmean(matrix, axis=0)
    gaps = np.isnan(matrix)
    matrix[gaps] = np.broadcast_to(typical, matrix.shape)[gaps]
    return unique, matrix


def prepare_climate(record: WeatherRecord, temperature_shift_c: float = 0.0) -> Climate:
    years, tmax = _year_matrix(record.dates, record.tmax)
    _, tmin = _year_matrix(record.dates, record.tmin)
    _, tdew = _year_matrix(record.dates, record.tdew)
    _, wind = _year_matrix(record.dates, record.wind)
    _, solar = _year_matrix(record.dates, record.srad)
    _, rain = _year_matrix(record.dates, record.rain)
    rain_alt = _year_matrix(record.dates, record.rain_alt)[1] if record.rain_alt is not None else None
    tdew = np.maximum(tdew, tmin - config.REFERENCE_DEW_POINT_GAP_C)
    tmax, tmin = tmax + temperature_shift_c, tmin + temperature_shift_c
    day_of_year = np.broadcast_to(np.arange(1, DAYS + 1), tmax.shape)
    reference = et0.reference_et(tmax, tmin, tdew, wind, solar, day_of_year, record.latitude, record.elevation)

    monthly_rain = np.array([rain[:, MONTH_OF_DAY == m].sum(axis=1).mean() for m in range(1, 13)])
    monthly_wind = np.array([wind[:, MONTH_OF_DAY == m].mean() for m in range(1, 13)])
    rain_days = rain[rain >= config.DRY_SPELL_RAIN_MM]
    heavy = float(np.percentile(rain_days, config.HEAVY_RAIN_PERCENTILE)) if rain_days.size else float("inf")

    # Alfalfa grows from the last -4 C night in spring to the first in autumn.
    cold = tmin <= ALFALFA_KILL_C
    first_half, second_half = cold[:, :182], cold[:, 182:]
    growing_start = np.where(first_half.any(axis=1), 182 - np.argmax(first_half[:, ::-1], axis=1), 0)
    growing_end = np.where(second_half.any(axis=1), 182 + np.argmax(second_half, axis=1), DAYS)
    return Climate(years=years, tmax=tmax, tmin=tmin, rain=rain, et0=reference, wind=wind, rain_alt=rain_alt, annual_rain=rain.sum(axis=1),
                   wettest_months=tuple(int(m) + 1 for m in np.argsort(monthly_rain)[-3:]),
                   windiest_months=tuple(int(m) + 1 for m in np.argsort(monthly_wind)[-3:]), heavy_rain_mm=heavy,
                   growing_start=growing_start, growing_end=growing_end)


def make_draws(seed: int, climate: Climate, rainfall_scenario: str, n: int = config.UNCERTAINTY_RUNS, max_cycle: int = 8) -> Draws:
    rng = np.random.default_rng(seed)
    n_years = len(climate.years)
    driest_share = config.RAINFALL_SCENARIOS[rainfall_scenario]["driest_share"]
    if driest_share >= 1.0:
        # Consecutive years keep real sequences, such as two dry years in a row.
        start = rng.integers(0, n_years, size=n)
        year_index = (start[:, None] + np.arange(max_cycle)[None, :]) % n_years
    else:
        pool = np.argsort(climate.annual_rain)[: max(2, round(n_years * driest_share))]
        year_index = rng.choice(pool, size=(n, max_cycle))
    use_alt = rng.random(n) < 0.5 if climate.rain_alt is not None else np.zeros(n, dtype=bool)
    return Draws(n=n, year_index=year_index, soil_u=rng.random(n), crop_v=rng.random(n), plant_z=rng.random(n),
                 use_alt_rain=use_alt, revenue_r=rng.random(n))


def _triangular(u: np.ndarray, low: float, mode: float, high: float) -> np.ndarray:
    if high - low < 1e-9:
        return np.full(u.shape, mode)
    cut = (mode - low) / (high - low)
    left = low + np.sqrt(u * (high - low) * (mode - low))
    right = high - np.sqrt((1 - u) * (high - low) * (high - mode))
    return np.where(u < cut, left, right)


def _lookup(matrix: np.ndarray, draws: Draws, cycle_years: int) -> np.ndarray:
    return matrix[draws.year_index[:, :cycle_years]].reshape(draws.n, cycle_years * DAYS)


def _in_months_mask(months: tuple[int, ...], cycle_years: int) -> np.ndarray:
    return np.tile(np.isin(MONTH_OF_DAY, months), cycle_years)[None, :]


@dataclass
class _ClimateSlice:
    cycle_years: int
    length: int
    n: int
    year_index: np.ndarray
    day: np.ndarray
    tmax: np.ndarray
    tmin: np.ndarray
    reference: np.ndarray
    rain: np.ndarray
    dry: np.ndarray
    v: np.ndarray
    wet_mask: np.ndarray
    wind_mask: np.ndarray
    fallow_kc: np.ndarray
    rain_t: np.ndarray
    ref_t: np.ndarray
    dry_t: np.ndarray


@dataclass
class _Schedule:
    listed: list[tuple[int, Phase, bool]]
    order: list[int]
    plants: list[np.ndarray]
    lengths: list[np.ndarray]
    delays: list[np.ndarray]
    fits: bool
    state: np.ndarray
    phase_at: np.ndarray
    kc: np.ndarray
    root: np.ndarray
    depletion_p: np.ndarray
    frost_sensitive: np.ndarray
    flowering: np.ndarray
    growing_any: np.ndarray
    full_use_on: np.ndarray


def _prepare_slice(climate: Climate, draws: Draws, cycle_years: int) -> _ClimateSlice:
    length = cycle_years * DAYS
    rain = _lookup(climate.rain, draws, cycle_years)
    if climate.rain_alt is not None:
        rain = np.where(draws.use_alt_rain[:, None], _lookup(climate.rain_alt, draws, cycle_years), rain)
    reference = _lookup(climate.et0, draws, cycle_years)
    dry = rain < config.DRY_SPELL_RAIN_MM
    v = draws.crop_v[:, None]
    fallow_kc = FALLOW_EVAPORATION_RANGE[0] + draws.crop_v * (FALLOW_EVAPORATION_RANGE[1] - FALLOW_EVAPORATION_RANGE[0])
    return _ClimateSlice(
        cycle_years=cycle_years,
        length=length,
        n=draws.n,
        year_index=draws.year_index[:, :cycle_years],
        day=np.arange(length)[None, :],
        tmax=_lookup(climate.tmax, draws, cycle_years),
        tmin=_lookup(climate.tmin, draws, cycle_years),
        reference=reference,
        rain=rain,
        dry=dry,
        v=v,
        wet_mask=_in_months_mask(climate.wettest_months, cycle_years),
        wind_mask=_in_months_mask(climate.windiest_months, cycle_years),
        fallow_kc=fallow_kc,
        rain_t=np.ascontiguousarray(rain.T),
        ref_t=np.ascontiguousarray(reference.T),
        dry_t=np.ascontiguousarray(dry.T),
    )


def _mid_season(phase: Phase, age: np.ndarray) -> np.ndarray:
    """FAO-56's mid-season stage, from full cover to the start of maturity: when the crop flowers and sets grain."""
    ini, dev, mid, _ = phase.stages
    return (age >= ini + dev) & (age < ini + dev + mid)


def _curve(phase: Phase, age: np.ndarray, v: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    ini, dev, mid, late = (float(s) for s in phase.stages)
    kc_mid = phase.kc_mid[0] + v * (phase.kc_mid[1] - phase.kc_mid[0])
    kc_end = phase.kc_end[0] + v * (phase.kc_end[1] - phase.kc_end[0])
    coefficient = np.where(age < ini, phase.kc_ini, np.where(
        age < ini + dev, phase.kc_ini + (kc_mid - phase.kc_ini) * (age - ini) / dev, np.where(
            age < ini + dev + mid, kc_mid, kc_mid + (kc_end - kc_mid) * (age - ini - dev - mid) / late)))
    deepest = phase.root_m[0] + v * (phase.root_m[1] - phase.root_m[0])
    depth = ROOT_START_M + (deepest - ROOT_START_M) * np.clip(age / (ini + dev), 0.0, 1.0)
    sensitive = _mid_season(phase, age)
    if phase.spring_planted:
        sensitive |= age < ini
    return coefficient, depth, sensitive


def _schedule_rotation(rotation: list[RotationYear], climate: Climate, draws: Draws, cs: _ClimateSlice) -> _Schedule:
    n, length, day, v = cs.n, cs.length, cs.day, cs.v
    listed: list[tuple[int, Phase, bool]] = []
    for index, year in enumerate(rotation):
        for position, phase in enumerate(year.crop.phases):
            if phase.stages or phase.perennial:
                listed.append((index, phase, position == 0))

    plants, lengths = [], []
    for index, phase, first in listed:
        if phase.perennial:
            plants.append(np.full(n, float(index * DAYS)))
            lengths.append(np.full(n, float(DAYS)))
            continue
        low, high = phase.plant_spread
        doy = (phase.plant_doy or 1) - 1 + low + draws.plant_z * (high - low)
        # An autumn-sown crop listed for a year was sown the autumn before, unless it follows another crop that year.
        autumn_sown = first and not phase.spring_planted and (phase.plant_doy or 0) > 200
        plants.append(index * DAYS + doy - (DAYS if autumn_sown else 0))
        lengths.append(np.full(n, float(phase.season_days or 0)))

    order = sorted(range(len(listed)), key=lambda k: float(np.median(plants[k])))
    delays = [np.zeros(n) for _ in listed]
    for _ in range(2):
        for position, k in enumerate(order):
            previous = order[position - 1]
            previous_end = plants[previous] + lengths[previous] - (length if position == 0 else 0)
            delay = np.maximum(previous_end + TURNAROUND_DAYS - plants[k], 0.0) if len(order) > 1 else np.zeros(n)
            plants[k] = plants[k] + delay
            delays[k] = delays[k] + delay
    occupied = sum(float(np.median(lengths[k])) for k in order) + TURNAROUND_DAYS * len(order)
    fits = occupied <= length and all(float(np.median(delays[k])) <= 45 for k in order)

    state = np.full((n, length), BARE, dtype=np.int8)
    phase_at = np.full((n, length), -1, dtype=np.int8)
    kc = np.zeros((n, length))
    root = np.full((n, length), PROFILE_DEPTH_M)
    depletion_p = np.full((n, length), 0.5)
    frost_sensitive = np.zeros((n, length), dtype=bool)
    flowering = np.zeros((n, length), dtype=bool)

    for position, k in enumerate(order):
        index, phase, _ = listed[k]
        age = (day - plants[k][:, None]) % length
        active = age < lengths[k][:, None]
        if phase.perennial:
            day_in_year = day % DAYS
            start = climate.growing_start[draws.year_index[:, index]][:, None]
            end = climate.growing_end[draws.year_index[:, index]][:, None]
            growing = (day_in_year >= start) & (day_in_year < end)
            coefficient = np.where(growing, phase.kc_mid[0], phase.kc_ini)
            depth = np.broadcast_to(phase.root_m[0] + v * (phase.root_m[1] - phase.root_m[0]), (n, length))
            sensitive = np.zeros((n, length), dtype=bool)
        else:
            coefficient, depth, sensitive = _curve(phase, age, v)
            flowering |= active & _mid_season(phase, age)
        state = np.where(active, CROP, state)
        phase_at = np.where(active, k, phase_at)
        kc = np.where(active, coefficient, kc)
        root = np.where(active, depth, root)
        depletion_p = np.where(active, phase.depletion_p, depletion_p)
        frost_sensitive |= active & sensitive

        following = order[(position + 1) % len(order)]
        end_day = plants[k] + lengths[k]
        gap = ((plants[following] + (length if position == len(order) - 1 else 0)) - end_day) if len(order) > 1 else (length - lengths[k])
        gap = np.maximum(gap, 0.0)
        since_end = (day - end_day[:, None]) % length
        in_gap = (since_end < gap[:, None]) & ~active
        leftover = RESIDUE if phase.residue in ("high", "living") else BARE
        state = np.where(in_gap & (state == BARE), leftover, state)
        cover = rotation[index].cover
        if cover is not None and cover.stages:
            window = gap - TURNAROUND_DAYS - COVER_END_BEFORE_PLANTING_DAYS
            cover_age = since_end - TURNAROUND_DAYS
            growing = in_gap & (cover_age >= 0) & (cover_age < window[:, None]) & (window[:, None] >= MIN_COVER_WINDOW_DAYS)
            coefficient, depth, _ = _curve(cover, cover_age, v)
            state = np.where(growing, COVER, state)
            kc = np.where(growing, coefficient, kc)
            root = np.where(growing, depth, root)
            depletion_p = np.where(growing, cover.depletion_p, depletion_p)
            # What a cover crop leaves behind protects the soil until the next planting.
            state = np.where(in_gap & (cover_age >= window[:, None]) & (window[:, None] >= MIN_COVER_WINDOW_DAYS), RESIDUE, state)

    growing_any = state >= COVER
    full_use_on = np.where(growing_any, kc * cs.reference, 0.0)
    return _Schedule(listed, order, plants, lengths, delays, fits, state, phase_at, kc, root, depletion_p, frost_sensitive, flowering, growing_any, full_use_on)


def _run_water_budget(rain_t: np.ndarray, ref_t: np.ndarray, dry_t: np.ndarray, grow_t: np.ndarray, kc_t: np.ndarray,
                      root_t: np.ndarray, dep_t: np.ndarray, fallow_kc: np.ndarray, awc: np.ndarray | None
                      ) -> tuple[np.ndarray, np.ndarray, np.ndarray | None, np.ndarray | None, np.ndarray | None, np.ndarray | None]:
    """Daily soil water in layers. Rain soaks in from the top, a crop draws only on the layers its roots have reached,
    and it is watered when the soil within its roots has dried past the crop's limit (FAO-56, chapter 8)."""
    length, total_n = grow_t.shape
    longest_dry = np.zeros(total_n)
    dry_run_end_t = np.zeros((length, total_n), dtype=bool)
    run = np.zeros(total_n)
    dry_grow_t = dry_t & grow_t
    has_soil = awc is not None
    if has_soil:
        layer_holds = awc * LAYER_M
        layer_top = (np.arange(SOIL_LAYERS) * LAYER_M)[:, None]
        # Bare soil only loses what its top layer holds, roughly 1.5 times that layer's plant-available water.
        evaporable = 1.5 * awc * EVAPORATION_LAYER_M
        surface = np.zeros(total_n)
        deficit = np.zeros((SOIL_LAYERS, total_n))
        moved = np.empty((SOIL_LAYERS, total_n))
        irrigation = np.zeros(total_n)
        residual = np.zeros(total_n)
        consumed = np.zeros(total_n)
        applied_t = np.zeros((length, total_n))
        demand_t = np.where(grow_t, kc_t * ref_t, 0.0)
        fallow_loss_t = fallow_kc[None, :] * ref_t
        depth_t = np.minimum(root_t, PROFILE_DEPTH_M)
        limit_t = dep_t * (awc[None, :] * depth_t)

    def spread(amount: np.ndarray, room: np.ndarray) -> np.ndarray:
        """Share an amount out over the layers from the top down, each layer taking what it has room for."""
        reach = np.minimum(np.cumsum(room, axis=0), amount)
        moved[0] = reach[0]
        np.subtract(reach[1:], reach[:-1], out=moved[1:])
        return reach[-1]

    # Two passes: the first only settles the soil water store into the cycle.
    for lap in range(2 if has_soil else 1):
        last_lap = lap == (1 if has_soil else 0)
        for d in range(length):
            run = np.where(dry_grow_t[d], run + 1.0, 0.0)
            if last_lap:
                np.maximum(longest_dry, run, out=longest_dry)
                dry_run_end_t[d] = run >= DRY_SPELL_DAYS
            if not has_soil:
                continue
            r_d = rain_t[d]
            g_d = grow_t[d]
            held_before = deficit.sum(axis=0)

            soaked = spread(r_d, deficit)
            deficit -= moved
            drained = r_d - soaked

            # The share of each layer the roots occupy today.
            rooted = np.clip((depth_t[d][None, :] - layer_top) / LAYER_M, 0.0, 1.0)
            bare_loss = np.minimum(fallow_loss_t[d], np.maximum(evaporable - surface, 0.0))
            surface = np.clip(surface - r_d + np.where(g_d, 0.0, bare_loss), 0.0, evaporable)
            crop_used = spread(np.where(g_d, demand_t[d], 0.0), (layer_holds[None, :] - deficit) * rooted)
            deficit += moved
            evaporated = np.where(g_d, 0.0, np.minimum(bare_loss, layer_holds - deficit[0]))
            deficit[0] += evaporated
            used = crop_used + evaporated

            # The need is the least water that keeps the crop from going short: each day, only what brings the soil
            # within its roots back to the crop's limit. Stored water is used first and room is left for rain.
            dry_in_roots = deficit * rooted
            dryness = dry_in_roots.sum(axis=0)
            applied = np.where(g_d, np.maximum(dryness - limit_t[d], 0.0), 0.0)
            deficit -= dry_in_roots * (applied / np.maximum(dryness, 1e-9))[None, :]
            if last_lap:
                irrigation += applied
                consumed += used
                applied_t[d] = applied
                # Water in minus water out must equal the change in what the soil holds.
                residual += (r_d + applied - used - drained) + (deficit.sum(axis=0) - held_before)
    if has_soil:
        return longest_dry, dry_run_end_t, irrigation, consumed, residual, applied_t
    return longest_dry, dry_run_end_t, None, None, None, None


def _longest_spell(mask: np.ndarray) -> np.ndarray:
    """Longest run of consecutive true days in each row, reading the cycle as a ring as the schedule does."""
    length = mask.shape[1]
    ring = np.concatenate([mask, mask], axis=1)
    day = np.arange(2 * length)
    last_break = np.maximum.accumulate(np.where(ring, -1, day), axis=1)
    return np.minimum((day - last_break).max(axis=1), length)


def _seasons(cs: _ClimateSlice, sched: _Schedule, members: list[int], applied_on: np.ndarray | None) -> Seasons:
    """What each season of one crop met, attributed to the weather year of its harvest."""
    killing = (cs.tmin <= config.KILLING_FROST_C) & sched.frost_sensitive
    hot_flowering = (cs.tmax >= config.FAILURE_HEAT_C) & sched.flowering
    runs = np.arange(cs.n)
    years, frost, spell, full_use, need = [], [], [], [], []
    for k in members:
        own = sched.phase_at == k
        harvest_cycle_year = ((sched.plants[k] + sched.lengths[k] - 1) % cs.length // DAYS).astype(int)
        years.append(cs.year_index[runs, harvest_cycle_year])
        frost.append((killing & own).any(axis=1))
        spell.append(_longest_spell(hot_flowering & own))
        full_use.append((sched.full_use_on * own).sum(axis=1))
        if applied_on is not None:
            need.append((applied_on * own).sum(axis=1))
    return Seasons(weather_year=np.concatenate(years), slot=np.repeat(np.arange(len(members)), cs.n), killing_frost=np.concatenate(frost),
                   flowering_heat_spell=np.concatenate(spell), full_use=np.concatenate(full_use),
                   water_need=np.concatenate(need) if applied_on is not None else None)


def _build_result(cs: _ClimateSlice, sched: _Schedule, climate: Climate, longest_dry: np.ndarray, dry_run_end: np.ndarray,
                  water_need: np.ndarray | None, residual: np.ndarray | None, annual_use: np.ndarray | None, applied_on: np.ndarray | None) -> SimResult:
    cycle_years, state, phase_at, growing_any = cs.cycle_years, sched.state, sched.phase_at, sched.growing_any
    bare = state == BARE
    hot = (cs.tmax >= config.HEAT_DAY_C) & growing_any
    frosty = (cs.tmin <= config.FROST_DAY_C) & sched.frost_sensitive
    heavy = (cs.rain >= climate.heavy_rain_mm) & bare

    cover_month = np.zeros((cycle_years, 12, 4))
    hazard_month = np.zeros((cycle_years, 12, len(HAZARDS)))
    crop_month: list[list[str | None]] = []
    listed = sched.listed
    n_listed = len(listed)
    for year in range(cycle_years):
        base = year * DAYS
        names: list[str | None] = []
        for month, (ms, me) in enumerate(_MONTH_BOUNDS):
            s, e = base + ms, base + me
            block = state[:, s:e]
            for code in range(4):
                cover_month[year, month, code] = float((block == code).mean())
            present = phase_at[:, s:e]
            valid = present[present >= 0]
            if valid.size and n_listed:
                counts = np.bincount(valid, minlength=n_listed)
                max_count = int(counts.max())
                names.append(listed[int(np.argmax(counts))][1].id if max_count >= 0.3 * present.size else None)
            else:
                names.append(None)
            hazard_month[year, month] = [
                float(frosty[:, s:e].any(axis=1).mean()),
                float((hot[:, s:e].sum(axis=1) >= HEAT_MONTH_DAYS).mean()),
                float(dry_run_end[:, s:e].any(axis=1).mean()),
                float(heavy[:, s:e].any(axis=1).mean()),
                float((bare[:, s:e].mean(axis=1) >= 0.5).mean()),
            ]
        crop_month.append(names)

    by_phase: dict[str, PhaseStats] = {}
    for phase_id in dict.fromkeys(phase.id for _, phase, _ in listed):
        members = [k for k, (_, phase, _) in enumerate(listed) if phase.id == phase_id]
        mine = np.isin(phase_at, members)
        by_phase[phase_id] = PhaseStats(
            phase=listed[members[0]][1], heat_days=(hot & mine).sum(axis=1) / len(members),
            frost_share=float(((frosty & mine).sum(axis=1) > 0).mean()),
            full_use=(sched.full_use_on * mine).sum(axis=1) / len(members),
            water_need=(applied_on * mine).sum(axis=1) / len(members) if applied_on is not None else None,
            seasons=_seasons(cs, sched, members, applied_on))

    timings = [PhaseTiming(listed[k][1], listed[k][0], float(np.median(sched.plants[k]) % DAYS) + 1,
                           float(np.median(sched.plants[k] + sched.lengths[k]) % DAYS) + 1, float(np.median(sched.delays[k]))) for k in sched.order]
    weeks = lambda mask: mask.sum(axis=1) / cycle_years / 7.0  # noqa: E731
    return SimResult(cycle_years=cycle_years, water_need=water_need, bare_weeks=weeks(bare), living_weeks=weeks(state >= COVER),
                     covered_weeks=weeks(state >= RESIDUE), bare_wet_weeks=weeks(bare & cs.wet_mask),
                     bare_windy_weeks=weeks(bare & cs.wind_mask), heat_days=hot.sum(axis=1) / cycle_years,
                     frost_days=frosty.sum(axis=1) / cycle_years, dry_spell_days=longest_dry, cover_month=cover_month,
                     crop_month=crop_month, hazard_month=hazard_month, timings=timings, fits=sched.fits,
                     balance_residual=residual, annual_use=annual_use, by_phase=by_phase)


def simulate(rotation: list[RotationYear], climate: Climate, draws: Draws, soil_awc: tuple[float, float, float] | None) -> SimResult:
    cs = _prepare_slice(climate, draws, len(rotation))
    sched = _schedule_rotation(rotation, climate, draws, cs)
    awc = _triangular(draws.soil_u, *soil_awc) if soil_awc is not None else None
    longest_dry, dry_run_end_t, irrigation, consumed, residual, applied_t = _run_water_budget(
        cs.rain_t, cs.ref_t, cs.dry_t, np.ascontiguousarray(sched.growing_any.T), np.ascontiguousarray(sched.kc.T),
        np.ascontiguousarray(sched.root.T), np.ascontiguousarray(sched.depletion_p.T), cs.fallow_kc, awc,
    )
    has_soil = awc is not None
    return _build_result(
        cs, sched, climate, longest_dry, np.ascontiguousarray(dry_run_end_t.T),
        irrigation / cs.cycle_years if has_soil else None, residual if has_soil else None,
        consumed / cs.cycle_years if has_soil else None, np.ascontiguousarray(applied_t.T) if has_soil else None,
    )


def simulate_batch(rotations_list: list[list[RotationYear]], climate: Climate, draws: Draws, soil_awc: tuple[float, float, float] | None) -> list[SimResult]:
    """Simulate multiple rotations in batches grouped by cycle length for exact vector efficiency."""
    if not rotations_list:
        return []
    out: list[SimResult | None] = [None] * len(rotations_list)
    by_years: dict[int, list[int]] = {}
    for idx, rotation in enumerate(rotations_list):
        by_years.setdefault(len(rotation), []).append(idx)
    awc_single = _triangular(draws.soil_u, *soil_awc) if soil_awc is not None else None
    n = draws.n
    for cycle_years, indices in by_years.items():
        cs = _prepare_slice(climate, draws, cycle_years)
        schedules = [_schedule_rotation(rotations_list[i], climate, draws, cs) for i in indices]
        count = len(schedules)
        rain_t = np.ascontiguousarray(np.tile(cs.rain_t, count))
        ref_t = np.ascontiguousarray(np.tile(cs.ref_t, count))
        dry_t = np.ascontiguousarray(np.tile(cs.dry_t, count))
        grow_t = np.ascontiguousarray(np.hstack([s.growing_any.T for s in schedules]))
        kc_t = np.ascontiguousarray(np.hstack([s.kc.T for s in schedules]))
        root_t = np.ascontiguousarray(np.hstack([s.root.T for s in schedules]))
        dep_t = np.ascontiguousarray(np.hstack([s.depletion_p.T for s in schedules]))
        fallow_kc = np.tile(cs.fallow_kc, count)
        awc = np.tile(awc_single, count) if awc_single is not None else None
        longest_dry, dry_run_end_t, irrigation, consumed, residual, applied_t = _run_water_budget(
            rain_t, ref_t, dry_t, grow_t, kc_t, root_t, dep_t, fallow_kc, awc,
        )
        has_soil = awc is not None
        for pos, orig_idx in enumerate(indices):
            s, e = pos * n, (pos + 1) * n
            out[orig_idx] = _build_result(
                cs, schedules[pos], climate, longest_dry[s:e], np.ascontiguousarray(dry_run_end_t[:, s:e].T),
                irrigation[s:e] / cycle_years if has_soil else None, residual[s:e] if has_soil else None,
                consumed[s:e] / cycle_years if has_soil else None, np.ascontiguousarray(applied_t[:, s:e].T) if has_soil else None,
            )
    return [item for item in out if item is not None]
