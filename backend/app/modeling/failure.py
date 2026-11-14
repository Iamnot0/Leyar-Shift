"""How often a crop would likely fail at this field, and the check that limits it most.

Both follow CropSuite v1.0 (Zabel, Knüttel and Poschlod 2025, Geosci. Model Dev. 18, 1067-1087) as a method, not as code. Its
recurrence rate of potential crop failure counts the years of the climate record in which a crop's thresholds are crossed. Its
limiting factor is the condition that constrains the crop most, after Liebig's law of the minimum.

A season fails on any of:
- frost: the night minimum reaches KILLING_FROST_C while the crop is emerging or setting grain;
- heat: FAILURE_HEAT_SPELL_DAYS days in a row reach FAILURE_HEAT_C while it flowers, FAO-56's mid-season stage. Judged only for a
  crop that relies on rain: a watered or flooded crop transpires and stays cooler than the daily air maximum of a 55 km grid;
- water: its FAO-33 relative yield, Ya/Ym = 1 - Ky (1 - ETa/ETc), falls under FAILURE_RELATIVE_YIELD. ETa is the crop's full use
  less the part of its water need beyond rain that the farmer's supply does not cover. Water a stressed crop could still draw from
  below its depletion limit is not credited, so this count leans high.
A weather year is a likely failure when at least FAILURE_RUN_SHARE of the runs fail one of the crop's seasons harvested that year,
such as the dry-season rice of a double crop. The runs differ in soil, planting date and crop within their stated ranges. The year is
counted once, under the cause that failed the most runs of its worst season.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.core import config
from app.modeling.crops import Phase
from app.modeling.simulate import Seasons

CAUSES = ("frost", "heat", "water")
SEVERITY = {"strained": 1, "does_not_fit": 2}


@dataclass(frozen=True)
class Failure:
    years_failed: int
    years_total: int
    # Failed years by cause; None for a cause that cannot be judged for this crop.
    by_cause: dict[str, int | None]


def relative_yield(ky: float, full_use: np.ndarray, shortfall: np.ndarray) -> np.ndarray:
    """FAO-33: 1 - Ya/Ym = Ky (1 - ETa/ETc), with ETa the full use less the shortfall."""
    return 1.0 - ky * shortfall / np.maximum(full_use, 1e-9)


def failed_seasons(phase: Phase, seasons: Seasons, supply_mm: float | None) -> dict[str, np.ndarray | None]:
    """Which seasons each cause fails. A supply of None is unlimited, 0 is rain alone. Frost and heat need a crop with growth
    stages, heat a crop that relies on rain, and water the soil values and the crop's yield response factor."""
    staged = phase.stages is not None
    rain_alone = supply_mm == 0 and phase.id != "rice"
    water = None
    if seasons.water_need is not None and phase.ky is not None:
        shortfall = np.zeros_like(seasons.water_need) if supply_mm is None else np.maximum(seasons.water_need - supply_mm, 0.0)
        water = relative_yield(phase.ky, seasons.full_use, shortfall) < config.FAILURE_RELATIVE_YIELD
    return {"frost": seasons.killing_frost if staged else None,
            "heat": seasons.flowering_heat_spell >= config.FAILURE_HEAT_SPELL_DAYS if staged and rain_alone else None,
            "water": water}


def recurrence(phase: Phase, seasons: Seasons, supply_mm: float | None) -> Failure | None:
    """Weather years in which the crop would likely fail, by cause. None when no cause can be judged."""
    failed = {cause: flags for cause, flags in failed_seasons(phase, seasons, supply_mm).items() if flags is not None}
    if not failed:
        return None
    any_cause = np.logical_or.reduce(list(failed.values()))
    counts = dict.fromkeys(failed, 0)
    years = np.unique(seasons.weather_year)
    for year in years:
        harvests = [group for slot in np.unique(seasons.slot) if (group := (seasons.weather_year == year) & (seasons.slot == slot)).any()]
        worst = max(harvests, key=lambda group: any_cause[group].mean())
        if any_cause[worst].mean() >= config.FAILURE_RUN_SHARE:
            counts[max(failed, key=lambda cause: failed[cause][worst].mean())] += 1
    return Failure(sum(counts.values()), len(years), {cause: counts.get(cause) for cause in CAUSES})


def limiting_check(checks: list[tuple[str, str, float]]) -> str | None:
    """Of (check, status, figure over its status threshold) in check order: the worst status, then the furthest past its
    threshold, then the first. None when every check fits or cannot be judged."""
    constraining = [(SEVERITY[status], over, check) for check, status, over in checks if status in SEVERITY]
    return max(constraining, key=lambda item: item[:2])[2] if constraining else None
