"""Turns gathered sources and simulated rotations into the contract's Analysis and zone payloads."""

from __future__ import annotations

from typing import Any

import numpy as np

from app.adapters.base import SourceState
from app.core import config
from app.core.provenance import DATASETS, AccessTier, EvidenceKind, NullReason, missing, quantity
from app.modeling import failure, rotations
from app.modeling.engine import Evaluated, Gathered
from app.modeling.simulate import HAZARDS, STATE_NAMES, Draws

LOW, HIGH = config.INTERVAL[1], config.INTERVAL[2]
WEATHER_PERIOD = (f"{config.BASELINE_FIRST_YEAR}-01-01", f"{config.BASELINE_LAST_YEAR}-12-31")
BARE_NDVI = 0.25
SCORE_LABELS = {
    "water_balance": ("Water use", "Water the crops need beyond rain and stored soil water", "mm/yr", False, False,
                      "How much water the crops want that rain and the soil do not supply."),
    "soil_health": ("Soil health", None, None, None, True,
                    "Weeks of living roots, weeks of soil cover, the share of legumes and the number of crop families, combined."),
    "erosion": ("Soil washing away", "Bare-soil weeks in the three wettest months", "weeks/yr", False, False,
                "How long the soil lies uncovered when the heaviest rain usually comes."),
    "climate_risk": ("Weather risk", "Heat and frost days while a crop is exposed", "days/yr", False, False,
                     "Days of damaging heat or frost that fall while a crop is in the ground."),
    "pest_break": ("Pest break", "Years in a row of one crop family", "years", False, False,
                   "How often the rotation changes crop family, which breaks pest and disease cycles. 4 means it never changes."),
    "economics": ("Income", "Gross revenue", "USD/ha/yr", True, False,
                  "Reported yield times reported price. Costs are not included."),
}
SCORE_PRIORITY = {score: priority for priority, score in config.PRIORITY_TO_SCORE.items()}


def _pct(values: np.ndarray) -> tuple[float, float, float]:
    return float(np.median(values)), float(np.percentile(values, LOW)), float(np.percentile(values, HIGH))


def _past(status: str, figure: float, strained_at: float, short_at: float | None) -> float:
    """How far a figure is past the threshold its status was decided on, as a share of that threshold. Higher figures are worse."""
    threshold = {"strained": strained_at, "does_not_fit": short_at}.get(status)
    return figure / threshold - 1.0 if threshold else 0.0


def consistency_quantity(baseline: rotations.Baseline) -> dict:
    """How much of the recent crop history the detected rotation matches."""
    mapped = [row for row in baseline.observed[-rotations.RECENT_YEARS:] if row.crop_id]
    return quantity(baseline.consistent_share, "fraction", kind=EvidenceKind.SATELLITE, tier=AccessTier.LIVE, datasets=["usda_cdl"],
                    period=(f"{mapped[0].year}-01-01", f"{mapped[-1].year}-12-31"), n_valid=len(mapped), n_expected=rotations.RECENT_YEARS, needs_local=True,
                    note=None if baseline.clean_cycle else "The crop map shows no clean repeating cycle, so the most recent years are used. Please check.")


def observed_years(baseline: rotations.Baseline) -> list[dict]:
    return [{"year": row.year, "crop_id": row.crop_id, "class_name": row.class_name, "share_of_field": round(row.share, 3), "n_cells": row.n_cells}
            for row in baseline.observed]


class Builder:
    def __init__(self, request: dict[str, Any], gathered: Gathered, results: list[Evaluated], baseline: rotations.Baseline,
                 draws: Draws, weights: dict[str, float], seed_hex: str) -> None:
        # Set when the farmer's first priority has no score for some rotation: then nothing is ranked.
        self.unranked: str | None = None
        self.request, self.g, self.results, self.baseline = request, gathered, results, baseline
        self.draws, self.weights, self.seed_hex = draws, weights, seed_hex
        self.us = gathered.place.conterminous_us
        self.weather = ["nasa_power"] + (["era5_open_meteo"] if gathered.record.rain_alt is not None else [])
        self.soil = [gathered.soil.source] if gathered.soil is not None else []
        self.calendars = ["nass_quickstats"] if gathered.states.get("nass_quickstats") and gathered.states["nass_quickstats"].available else []

    # ---- quantities
    def modeled(self, values: np.ndarray, unit: str, datasets: list[str], *, note: str | None = None, needs_local: bool = False, digits: int = 1) -> dict:
        median, low, high = _pct(values)
        return quantity(median, unit, kind=EvidenceKind.MODEL, tier=AccessTier.MODELED, datasets=datasets, low=low, high=high,
                        period=WEATHER_PERIOD, note=note, needs_local=needs_local, digits=digits)

    def unavailable(self, unit: str, dataset_id: str, fallback: str) -> dict:
        state = self.g.states.get(dataset_id)
        if state is not None and not state.available:
            return missing(unit, state.null_reason, state.message or fallback, datasets=[dataset_id])
        return missing(unit, NullReason.OUT_OF_COVERAGE, fallback, datasets=[dataset_id])

    def soil_missing(self, unit: str) -> dict:
        dataset_id = "ssurgo" if self.us else "soilgrids"
        return self.unavailable(unit, dataset_id, "No soil water-holding values are available for this field, so the water budget cannot be run.")

    @property
    def money(self) -> str:
        return f"{self.g.currency.code}/ha/yr"

    def income_sources(self, evaluated: Evaluated) -> list[str]:
        used = {self.g.revenue[phase.id].dataset_id for year in evaluated.years for phase in year.crop.phases if phase.id in self.g.revenue}
        return sorted(source for source in used if source)

    def income_quantity(self, values: np.ndarray, evaluated: Evaluated, note: str | None = None) -> dict:
        sources = self.income_sources(evaluated)
        years = sorted({year for cycle in evaluated.years for phase in cycle.crop.phases if phase.id in self.g.revenue for year in self.g.revenue[phase.id].years})
        # Yield times price is our own sum, so it is marked as worked out here; the records behind it are named as its sources.
        return quantity(float(np.median(values)), self.money, kind=EvidenceKind.MODEL, tier=AccessTier.MODELED, datasets=sources, low=float(np.percentile(values, LOW)),
                        high=float(np.percentile(values, HIGH)), period=(f"{years[0]}-01-01", f"{years[-1]}-12-31"), note=note, needs_local=True, digits=0)

    def income_note(self, evaluated: Evaluated) -> str:
        revenues = [self.g.revenue[phase.id] for year in evaluated.years for phase in year.crop.phases if phase.id in self.g.revenue]
        parts = []
        if any(revenue.dataset_id == "nass_quickstats" for revenue in revenues):
            levels = sorted({revenue.yields.level for revenue in revenues if revenue.dataset_id == "nass_quickstats"})
            parts.append(f"From {' and '.join(levels)} average yields and state prices, which mix irrigated and rain-fed fields.")
        if any(revenue.dataset_id == "faostat" for revenue in revenues):
            years = sorted({year for revenue in revenues if revenue.dataset_id == "faostat" for year in revenue.years})
            parts.append(f"From the country's average yield and average farm price, {years[0]} to {years[-1]}, as reported to FAO. Your district and your buyer will differ.")
        if any(revenue.dataset_id is None for revenue in revenues):
            parts.append("Uses the yield and price you entered.")
        return " ".join(parts + ["Production costs are not included."])

    def revenue_missing(self, evaluated: Evaluated) -> dict:
        source = "nass_quickstats" if self.us else "faostat"
        state = self.g.states.get(source)
        lacking = sorted({phase.id for year in evaluated.years for phase in year.crop.phases if (phase.stages or phase.perennial) and phase.id not in self.g.revenue})
        reasons = sorted({self.g.revenue_gaps[phase_id] for phase_id in lacking if phase_id in self.g.revenue_gaps})
        if reasons:
            return missing(self.money, NullReason.INSUFFICIENT, " ".join(reasons) + " Enter your own yield and price to see income.", datasets=[source])
        if state is not None and not state.available:
            return missing(self.money, state.null_reason, state.message or "Yield and price records could not be loaded.", datasets=[source])
        names = " and ".join(name.replace("_", " ") for name in lacking)
        return missing(self.money, NullReason.INSUFFICIENT, f"There are too few reported yields and prices for {names} to work out revenue. Enter your own yield and price to see income.",
                       datasets=[source])

    # ---- datasets
    def datasets(self) -> list[dict]:
        out = []
        for spec in DATASETS.values():
            state = self.g.states.get(spec.id)
            if state is None:
                if spec.context_only:
                    continue
                if not spec.configured:
                    state = SourceState.not_configured(spec.id)
                elif spec.scope.value != "global" and not self.us:
                    state = SourceState.out_of_coverage(spec.id, f"{spec.name} covers the United States only.")
                else:
                    continue
            out.append({
                "id": spec.id, "name": spec.name, "provider": spec.provider, "role": spec.role, "coverage_scope": spec.scope.value,
                "status": state.status, "null_reason": state.null_reason.value if state.null_reason else None,
                "retryable": state.null_reason is NullReason.FETCH_FAILED, "message": state.message,
                "access_tier": spec.tier.value if state.available else None, "evidence_kind": spec.evidence_kind.value,
                "native_resolution_m": spec.native_resolution_m, "footprint": state.footprint,
                "period": None if state.period is None else {"start": state.period[0], "end": state.period[1]},
                "as_of": state.as_of if state.available else None, "source_url": spec.source_url,
            })
        return out

    # ---- scores
    def score(self, evaluated: Evaluated, score_id: str) -> dict:
        label, physical_label, unit, physical_better, composite, description = SCORE_LABELS[score_id]
        sim, values = evaluated.sim, evaluated.scores[score_id]
        physical, components, explanation, reason = None, [], description, None
        local = False
        if score_id == "water_balance":
            if sim.water_need is None:
                reason = self.soil_missing("mm/yr")
            else:
                note = "Water lost to runoff and, for rice, to seepage from flooded fields is not counted, so real use is higher." if any(
                    phase.id == "rice" for year in evaluated.years for phase in year.crop.phases) else "Runoff is not counted, so real need is a little lower after heavy storms."
                physical = self.modeled(sim.water_need, "mm/yr", self.weather + self.soil + self.calendars, note=note, digits=0)
                explanation = f"These crops want about {physical['value']:.0f} mm of water a year beyond what rain and the soil supply ({physical['low']:.0f} to {physical['high']:.0f} mm in 8 years out of 10)."
        elif score_id == "soil_health":
            phases = [phase for year in evaluated.years for phase in year.crop.phases if phase.stages or phase.perennial]
            families = sorted({phase.family for phase in phases if phase.family})
            legumes = sum(phase.nitrogen_fixing for phase in phases) / len(phases) if phases else 0.0
            fixed = lambda value, unit: quantity(value, unit, kind=EvidenceKind.MODEL, tier=AccessTier.MODELED, datasets=[], low=value, high=value)  # noqa: E731
            components = [
                {"id": "living_cover_weeks", "label": "Weeks with a crop or cover crop growing", "higher_is_better": True, "quantity": self.modeled(sim.living_weeks, "weeks/yr", self.weather + self.calendars)},
                {"id": "soil_cover_weeks", "label": "Weeks with the soil covered by plants or stubble", "higher_is_better": True, "quantity": self.modeled(sim.covered_weeks, "weeks/yr", self.weather + self.calendars, needs_local=True, note="Assumes stubble is left on the surface until the next planting. Tillage would shorten this.")},
                {"id": "legume_share", "label": "Share of crops that fix nitrogen", "higher_is_better": True, "quantity": fixed(legumes, "fraction")},
                {"id": "crop_families", "label": "Number of crop families", "higher_is_better": True, "quantity": fixed(float(len(families)), "count")},
            ]
            explanation = f"Something is growing for about {np.median(sim.living_weeks):.0f} weeks a year, across {len(families)} crop famil{'y' if len(families) == 1 else 'ies'}."
        elif score_id == "erosion":
            physical = self.modeled(sim.bare_wet_weeks, "weeks/yr", self.weather + self.calendars, needs_local=True,
                                    note="Assumes stubble is left on the surface. It counts weeks of bare soil in the rain, not tonnes of soil lost, and wind erosion is judged separately.")
            components = [{"id": "bare_windy_weeks", "label": "Bare-soil weeks in the three windiest months", "higher_is_better": False,
                           "quantity": self.modeled(sim.bare_windy_weeks, "weeks/yr", self.weather + self.calendars)}]
            if self.g.slope_percent is not None and self.g.grid.field_mean(self.g.slope_percent) is not None:
                components.append({"id": "mean_slope", "label": "Average slope of the field", "higher_is_better": False,
                                   "quantity": quantity(self.g.grid.field_mean(self.g.slope_percent), "percent", kind=EvidenceKind.SATELLITE, tier=AccessTier.LIVE, datasets=["nasadem"], n_valid=self.g.grid.n_cells, n_expected=self.g.grid.n_cells)})
            if self.g.soil is not None and self.g.soil.wind_erodibility is not None:
                components.append({"id": "wind_erodibility", "label": "Soil wind erodibility index, tons per acre a year", "higher_is_better": False,
                                   "quantity": quantity(self.g.soil.wind_erodibility, "tons/acre", kind=EvidenceKind.SOIL_SURVEY, tier=AccessTier.LIVE, datasets=["ssurgo"], digits=0)})
            explanation = f"The soil lies bare for about {physical['value']:.1f} weeks of the three wettest months."
            local = True
        elif score_id == "climate_risk":
            physical = self.modeled(sim.heat_days + sim.frost_days, "days/yr", self.weather + self.calendars, digits=0)
            components = [
                {"id": "heat_days", "label": f"Days at or above {config.HEAT_DAY_C:g} °C while a crop is growing", "higher_is_better": False, "quantity": self.modeled(sim.heat_days, "days/yr", self.weather + self.calendars, digits=0)},
                {"id": "frost_days", "label": f"Days at or below {config.FROST_DAY_C:g} °C while a crop is emerging or setting grain", "higher_is_better": False, "quantity": self.modeled(sim.frost_days, "days/yr", self.weather + self.calendars, digits=1)},
                {"id": "longest_dry_spell", "label": "Longest run of dry days while a crop is growing", "higher_is_better": False, "quantity": self.modeled(sim.dry_spell_days, "days", self.weather + self.calendars, digits=0)},
            ]
            explanation = f"About {np.median(sim.heat_days):.0f} heat days and {np.median(sim.frost_days):.1f} frost days a year fall while a crop is exposed."
        elif score_id == "pest_break":
            if evaluated.family_run is None:
                reason = missing("years", NullReason.INSUFFICIENT, "This rotation has no crop years to judge.")
            else:
                run = float(evaluated.family_run)
                physical = quantity(run, "years", kind=EvidenceKind.MODEL, tier=AccessTier.MODELED, datasets=[], low=run, high=run, digits=0,
                                    note="4 means the crop family never changes.", needs_local=True)
                explanation = "The crop family never changes, so pests and diseases of that family are never interrupted." if run >= 4 else f"The same crop family is grown for at most {run:.0f} year{'s' if run > 1 else ''} in a row."
                local = True
        elif score_id == "economics":
            if evaluated.revenue is None:
                reason = self.revenue_missing(evaluated)
            else:
                physical = self.income_quantity(evaluated.revenue, evaluated, self.income_note(evaluated))
                explanation = f"Gross revenue of about {physical['value']:,.0f} {self.g.currency.name} a hectare a year, before any costs."
                local = True
        if values is None:
            reason = reason or missing("", NullReason.INSUFFICIENT, "This score could not be worked out.")
            return {"id": score_id, "label": label, "value": None, "low": None, "high": None, "higher_is_better": True, "composite": composite,
                    "physical": None, "physical_label": physical_label, "physical_higher_is_better": physical_better, "components": components,
                    "weight": round(self.weights[score_id], 4), "explanation": reason["null_explanation"], "null_reason": reason["null_reason"],
                    "null_explanation": reason["null_explanation"], "retryable": reason["retryable"]}
        median, low, high = _pct(values)
        if physical is not None and local:
            physical["needs_local_judgment"] = True
        return {"id": score_id, "label": label, "value": round(median, 1), "low": round(low, 1), "high": round(high, 1), "higher_is_better": True,
                "composite": composite, "physical": physical, "physical_label": physical_label, "physical_higher_is_better": physical_better,
                "components": components, "weight": round(self.weights[score_id], 4), "explanation": explanation, "null_reason": None,
                "null_explanation": None, "retryable": False}

    # ---- how the conditions suit each crop
    def crop_fit(self, evaluated: Evaluated) -> list[dict]:
        g, farmer = self.g, self.request["farmer"]
        frost_free = g.frost_free_days
        season_quantity = quantity(frost_free, "days", kind=EvidenceKind.MODEL, tier=AccessTier.LIVE, datasets=["nasa_power"], low=frost_free, high=frost_free,
                                   period=WEATHER_PERIOD, n_valid=len(g.climate.years), n_expected=len(g.climate.years), digits=0)
        supply = farmer["water_availability"]
        strained_at, short_at = config.CROP_FIT_WATER_MM[supply]
        allowance = farmer.get("irrigation_allowance_mm")
        if supply == "limited" and allowance:
            strained_at, short_at = float(allowance), 1.5 * float(allowance)
        supply_words = {"rain_fed": "rain alone", "limited": "a limited water supply", "reliable": "a reliable water supply"}[supply]
        supply_mm = {"rain_fed": 0.0, "limited": strained_at, "reliable": None}[supply]
        out = []
        for stats in evaluated.sim.by_phase.values():
            phase = stats.phase
            name = phase.name.split(" (")[0]
            checks = []

            if phase.perennial or not phase.spring_planted or frost_free >= 364:
                checks.append(("season_length", "fits", dict(season_quantity), f"Frost does not cut short the season {name.lower()} needs here.", 0.0))
            else:
                needed = phase.frost_sensitive_days or 0
                margin = frost_free - needed
                status = "fits" if margin >= config.CROP_FIT_SEASON_MARGIN_DAYS else "does_not_fit" if margin < -config.CROP_FIT_SEASON_MARGIN_DAYS else "strained"
                checks.append(("season_length", status, dict(season_quantity), f"{name} needs about {phase.frost_sensitive_days} frost-free days from sowing until the grain starts to ripen; the frost-free season here is about {frost_free:.0f}.",
                               _past(status, needed, frost_free - config.CROP_FIT_SEASON_MARGIN_DAYS, frost_free + config.CROP_FIT_SEASON_MARGIN_DAYS)))

            heat = self.modeled(stats.heat_days, "days/yr", self.weather + self.calendars, digits=0, needs_local=True,
                                note=f"One threshold of {config.HEAT_DAY_C:g} °C is used for every crop. Some crops stand more heat than others.")
            status = "fits" if heat["value"] < config.CROP_FIT_HEAT_DAYS else "strained"
            checks.append(("heat", status, heat, f"About {heat['value']:.0f} days a season reach {config.HEAT_DAY_C:g} °C while {name.lower()} is growing.",
                           _past(status, heat["value"], config.CROP_FIT_HEAT_DAYS, None)))

            share = stats.frost_share
            frost = quantity(share, "fraction", kind=EvidenceKind.MODEL, tier=AccessTier.MODELED, datasets=self.weather + self.calendars, low=share, high=share,
                             period=WEATHER_PERIOD)
            low_share, high_share = config.CROP_FIT_FROST_SHARES
            status = "fits" if share < low_share else "does_not_fit" if share >= high_share else "strained"
            checks.append(("frost", status, frost, f"Frost falls while {name.lower()} is emerging or setting grain in about {round(share * 10)} years out of 10.",
                           _past(status, share, low_share, high_share)))

            if stats.water_need is None:
                checks.append(("water", "unknown", self.soil_missing("mm/yr"), "The water budget needs soil values that are not available for this field.", 0.0))
            else:
                need = self.modeled(stats.water_need, "mm/yr", self.weather + self.soil + self.calendars, digits=0)
                status = "fits" if need["value"] <= strained_at else "does_not_fit" if short_at is not None and need["value"] > short_at else "strained"
                checks.append(("water", status, need, f"{name} uses about {float(np.median(stats.full_use)):.0f} mm in a season here. Rain and stored soil water cover part of it, "
                               f"leaving about {need['value']:.0f} mm to find. You said you have {supply_words}.", _past(status, need["value"], strained_at, short_at)))

            likely = failure.recurrence(phase, stats.seasons, supply_mm)
            out.append({"crop_id": phase.id, "crop_name": phase.name, "checks": [{"check": c, "status": s, "quantity": q, "text": t} for c, s, q, t, _ in checks],
                        "limiting_check": failure.limiting_check([(c, s, over) for c, s, _, _, over in checks]),
                        "failure": None if likely is None else {"years_failed": likely.years_failed, "years_total": likely.years_total, "by_cause": likely.by_cause}})
        return out

    # ---- calendars
    def cover_calendar(self, evaluated: Evaluated) -> dict:
        sim = evaluated.sim
        cells = []
        for year in range(sim.cycle_years):
            for month in range(12):
                shares = sim.cover_month[year, month]
                state = STATE_NAMES[int(np.argmax(shares))]
                crop_id = sim.crop_month[year][month] if state == "crop" else ("cover_crop" if state == "cover_crop" else None)
                cells.append({"cycle_year": year + 1, "month": month + 1, "state": state, "crop_id": crop_id, "covered_fraction": round(float(1.0 - shares[0]), 2)})
        datasets = self.weather + self.calendars
        return {"evidence_kind": EvidenceKind.MODEL.value, "access_tier": AccessTier.MODELED.value, "dataset_ids": datasets,
                "period": {"start": WEATHER_PERIOD[0], "end": WEATHER_PERIOD[1]}, "n_valid_obs": None, "n_expected_obs": None, "cells": cells,
                "bare_weeks_per_year": self.modeled(sim.bare_weeks, "weeks/yr", datasets, needs_local=True, note="Assumes stubble is left on the surface until the next planting."),
                "living_cover_weeks_per_year": self.modeled(sim.living_weeks, "weeks/yr", datasets)}

    def risk_calendar(self, evaluated: Evaluated) -> dict:
        sim = evaluated.sim
        cells = []
        for year in range(sim.cycle_years):
            for month in range(12):
                for position, hazard in enumerate(HAZARDS):
                    share = float(sim.hazard_month[year, month, position])
                    if share < 0.05:
                        continue
                    level = 2 if share >= config.RISK_LEVEL_SHARES[1] else 1 if share >= config.RISK_LEVEL_SHARES[0] else 0
                    cells.append({"cycle_year": year + 1, "month": month + 1, "hazard": hazard, "level": level, "share_of_years": round(share, 2),
                                  "exposed_crop_id": sim.crop_month[year][month]})
        return {"evidence_kind": EvidenceKind.MODEL.value, "access_tier": AccessTier.MODELED.value, "dataset_ids": self.weather + self.calendars,
                "native_resolution_m": DATASETS["nasa_power"].native_resolution_m, "period": {"start": WEATHER_PERIOD[0], "end": WEATHER_PERIOD[1]},
                "n_years": len(self.g.climate.years), "cells": cells, "null_reason": None, "null_explanation": None}

    # ---- comparisons between rotations
    def tradeoffs(self, evaluated: Evaluated, current: Evaluated) -> list[dict]:
        physical_of = {"water_balance": lambda e: e.sim.water_need, "erosion": lambda e: e.sim.bare_wet_weeks,
                       "climate_risk": lambda e: e.sim.heat_days + e.sim.frost_days, "economics": lambda e: e.revenue}
        units = {"water_balance": "mm/yr", "erosion": "weeks/yr", "climate_risk": "days/yr"}
        words = {"water_balance": "water need", "soil_health": "soil health", "erosion": "bare soil in the wettest months", "climate_risk": "heat and frost while a crop is growing",
                 "pest_break": "pest-cycle break", "economics": "gross revenue"}
        out = []
        for score_id in config.SCORE_ORDER:
            mine, theirs = evaluated.scores[score_id], current.scores[score_id]
            if mine is None or theirs is None:
                out.append({"score_id": score_id, "direction": "unknown", "share_of_runs_better": None, "score_delta": None, "physical_delta": None,
                            "text": f"{words[score_id].capitalize()} could not be compared because one side has no value."})
                continue
            difference = mine - theirs
            # Wins are counted strictly, so the share is always a whole number of runs.
            wins, level = int((difference > 0).sum()), int((difference == 0).sum())
            share = wins / self.draws.n
            delta = float(np.median(difference))
            if abs(delta) < config.TRADEOFF_SIMILAR_DELTA:
                direction = "similar"
            elif share >= config.TRADEOFF_BETTER_SHARE:
                direction = "better"
            elif share <= config.TRADEOFF_WORSE_SHARE:
                direction = "worse"
            else:
                direction = "uncertain"
            physical = None
            if score_id in physical_of and physical_of[score_id](evaluated) is not None and physical_of[score_id](current) is not None:
                gap = physical_of[score_id](evaluated) - physical_of[score_id](current)
                if score_id == "economics":
                    physical = self.income_quantity(gap, evaluated)
                else:
                    physical = self.modeled(gap, units[score_id], self.weather + (self.soil if score_id == "water_balance" else []) + self.calendars,
                                            digits=0 if score_id != "erosion" else 1)
            tally = f"better in {wins} of {self.draws.n} runs" + (f", level in {level}" if level else "")
            texts = {"better": f"Better on {words[score_id]}: {tally}.",
                     "worse": f"Worse on {words[score_id]}: {tally}.",
                     "uncertain": f"Too close to call on {words[score_id]}: {tally}.",
                     "similar": f"About the same on {words[score_id]}: {tally}."}
            out.append({"score_id": score_id, "direction": direction, "share_of_runs_better": round(share, 3), "score_delta": round(delta, 1),
                        "physical_delta": physical, "text": texts[direction]})
        return out

    def benefits(self, evaluated: Evaluated, current: Evaluated) -> list[dict]:
        out = []
        phases = [phase for year in evaluated.years for phase in year.crop.phases if phase.stages or phase.perennial]
        if any(phase.nitrogen_fixing for phase in phases):
            names = sorted({phase.name.lower() for phase in phases if phase.nitrogen_fixing})
            out.append({"tag": "nitrogen_fixation", "text": f"{' and '.join(names).capitalize()} fix nitrogen from the air, which can cut fertiliser needs for the next crop.", "quantity": None})
        if any(year.cover is not None for year in evaluated.years):
            out.append({"tag": "soil_cover", "text": "A cover crop keeps living roots in the soil after harvest, which protects it from rain and wind and feeds soil life.",
                        "quantity": self.modeled(evaluated.sim.living_weeks, "weeks/yr", self.weather + self.calendars)})
        if any(phase.root_m and phase.root_m[1] >= 1.7 for phase in phases):
            out.append({"tag": "deep_rooting", "text": "Deep-rooted crops open channels that help rain soak in and reach water lower in the soil.", "quantity": None})
        if evaluated.family_run is not None and evaluated.family_run <= 2 and len({phase.family for phase in phases}) > 1:
            out.append({"tag": "pest_cycle_break", "text": "Changing crop family interrupts pests, weeds and diseases that build up under one crop.", "quantity": None})
        if any(year.crop.category == "forage" for year in evaluated.years):
            out.append({"tag": "forage", "text": "Includes a crop that can be cut or grazed for forage.", "quantity": None})
        if evaluated is not current and evaluated.sim.water_need is not None and current.sim.water_need is not None:
            saved = current.sim.water_need - evaluated.sim.water_need
            if np.median(saved) > 0:
                out.append({"tag": "water_saving", "text": "Needs less water than your rotation now.", "quantity": self.modeled(saved, "mm/yr", self.weather + self.soil + self.calendars, digits=0)})
        if evaluated is not current and evaluated.revenue is not None and current.revenue is not None and np.median(evaluated.revenue - current.revenue) > 0:
            out.append({"tag": "income", "text": "Higher gross revenue than your rotation now, before costs.",
                        "quantity": self.income_quantity(evaluated.revenue - current.revenue, evaluated)})
        return out

    def reasons(self, evaluated: Evaluated, current: Evaluated) -> list[dict]:
        if evaluated is current:
            if self.baseline.source == "cdl_derived":
                seen = sum(1 for row in self.baseline.observed[-rotations.RECENT_YEARS:] if row.crop_id)
                text = f"This is the rotation the crop map shows on your field: it matches {self.baseline.consistent_share:.0%} of the last {seen} mapped years. Confirm or correct it."
            else:
                text = "This is the rotation you entered."
            return [{"signal": "bare_field" if self.baseline.source == "cdl_derived" else "farmer_priority", "text": text, "evidence_ids": []}]
        out = [{"signal": "farmer_priority", "text": evaluated.note, "evidence_ids": []}]
        top = self.request["farmer"]["priorities"][0]
        top_score = config.PRIORITY_TO_SCORE[top]
        if evaluated.scores[top_score] is not None and current.scores[top_score] is not None and np.median(evaluated.scores[top_score] - current.scores[top_score]) > config.TRADEOFF_SIMILAR_DELTA:
            out.append({"signal": "farmer_priority", "text": f"It does better than your rotation now on what you ranked first: {SCORE_LABELS[top_score][0].lower()}.", "evidence_ids": []})
        if evaluated.sim.water_need is not None and current.sim.water_need is not None and np.median(current.sim.water_need - evaluated.sim.water_need) > 25:
            out.append({"signal": "water", "text": "This rotation needs less water.", "evidence_ids": []})
        if np.median(current.sim.bare_weeks - evaluated.sim.bare_weeks) > 2:
            out.append({"signal": "bare_field", "text": "It leaves the soil bare for fewer weeks a year.", "evidence_ids": ["green-cover"] if self.g.scenes else []})
        shares = self.g.county_shares or {}
        local = [year.crop.name.lower() for year in evaluated.years if shares.get(year.crop.id, 0.0) >= config.LOCALLY_GROWN_MIN_SHARE]
        if local:
            out.append({"signal": "market", "text": f"{', '.join(sorted(set(local))).capitalize()} already grow{'s' if len(set(local)) == 1 else ''} on at least 1% of this county's cropland, so buyers and equipment exist nearby.", "evidence_ids": ["county-crops"]})
        return out

    def rotation_gaps(self, evaluated: Evaluated, current: Evaluated) -> tuple[list[dict], list[dict]]:
        gaps, reviews = [], []
        mine, theirs = rotations.crops_per_year(evaluated.years), rotations.crops_per_year(current.years)
        if mine < theirs and (evaluated.revenue is None or current.revenue is None):
            gaps.append({"id": "fewer-crops", "text": f"This rotation grows {mine:g} crop{'s' if mine != 1 else ''} a year; yours now grows {theirs:g}. Income is not scored here, "
                         "so what the smaller harvest costs you is not counted in any score.", "affects": ["economics"], "dataset_id": None, "null_reason": None})
        phases = [phase for year in evaluated.years for phase in year.crop.phases if phase.stages or phase.perennial]
        if any(phase.id == "rice" for phase in phases):
            gaps.append({"id": "rice-seepage", "text": "Water that seeps down from flooded rice fields is not counted. Real water use for rice is higher than shown.", "affects": ["water_balance"], "dataset_id": None, "null_reason": None})
        if evaluated.sim.water_need is not None:
            gaps.append({"id": "full-demand", "text": "The water figure is what healthy crops use when they are never short of water. Crops in real fields often use less, so read it as an upper estimate.", "affects": ["water_balance"], "dataset_id": None, "null_reason": None})
        gaps.append({"id": "tillage", "text": "Tillage is not known. Stubble is assumed to stay on the surface until the next planting; ploughing it in would mean more bare weeks.", "affects": ["erosion", "soil_health"], "dataset_id": None, "null_reason": None})
        if evaluated.revenue is None:
            reason = self.revenue_missing(evaluated)
            gaps.append({"id": "revenue", "text": reason["null_explanation"], "affects": ["economics"], "dataset_id": reason["dataset_ids"][0] if reason["dataset_ids"] else None,
                         "null_reason": reason["null_reason"]})
        else:
            gaps.append({"id": "costs", "text": "Seed, fertiliser, fuel, water and labour costs are not included, so revenue is not profit.", "affects": ["economics"], "dataset_id": None, "null_reason": None})
        if not self.g.region_exact:
            gaps.append({"id": "calendar-region", "text": "No crop calendar is set up for this part of the world. Planting dates and season lengths are those of temperate North America.", "affects": ["water_balance", "climate_risk", "erosion", "soil_health"], "dataset_id": None, "null_reason": None})
        elif not self.calendars:
            gaps.append({"id": "calendar-generic", "text": "Planting dates and season lengths come from general reference tables, not from records for your district.", "affects": ["water_balance", "climate_risk", "erosion", "soil_health"], "dataset_id": None, "null_reason": None})
        if not evaluated.sim.fits:
            gaps.append({"id": "season-fit", "text": "These crops do not fit into the cycle without delaying a planting by more than six weeks.", "affects": ["water_balance", "climate_risk"], "dataset_id": None, "null_reason": None})
        reviews.append({"topic": "Planting and harvest dates", "text": "Check the planting and harvest dates used here against what works on your ground.", "reviewer": "farmer"})
        reviews.append({"topic": "Varieties, herbicide carry-over and pests", "text": "Ask whether residues from current herbicides, or local pests and diseases, rule out any crop in this rotation.", "reviewer": "agronomist"})
        if evaluated.role == "alternative":
            reviews.append({"topic": "A buyer for each crop", "text": "Confirm there is a buyer and a delivery point within reach for every crop before planting it.", "reviewer": "buyer"})
        if self.request["farmer"]["water_availability"] != "rain_fed":
            reviews.append({"topic": "Water allocation", "text": "Check your well capacity and any allocation limit against the water need shown.", "reviewer": "water_authority"})
        return gaps, reviews

    def rotation_evidence(self, evaluated: Evaluated) -> list[dict]:
        sim, out = evaluated.sim, []
        if sim.water_need is not None:
            out.append({"id": f"{evaluated.id}-water", "kind": "water_balance", "title": "Water the crops need beyond rain", "summary": "Worked out day by day from 25 years of weather, the soil's water holding and each crop's needs.",
                        "quantity": self.modeled(sim.water_need, "mm/yr", self.weather + self.soil + self.calendars, digits=0), "series_id": None})
        out.append({"id": f"{evaluated.id}-bare", "kind": "bare_field_window", "title": "Weeks of bare soil a year", "summary": "Weeks with neither a growing plant nor stubble on the surface.",
                    "quantity": self.modeled(sim.bare_weeks, "weeks/yr", self.weather + self.calendars, needs_local=True), "series_id": None})
        out.append({"id": f"{evaluated.id}-heat", "kind": "heat_stress", "title": "Heat days while a crop is growing", "summary": f"Days at or above {config.HEAT_DAY_C:g} °C that fall inside a growing season.",
                    "quantity": self.modeled(sim.heat_days, "days/yr", self.weather + self.calendars, digits=0), "series_id": None})
        out.append({"id": f"{evaluated.id}-frost", "kind": "frost_risk", "title": "Frost days while a crop is vulnerable", "summary": "Frosts that fall while a crop is emerging or setting grain.",
                    "quantity": self.modeled(sim.frost_days, "days/yr", self.weather + self.calendars), "series_id": None})
        for phase_id in sorted({phase.id for year in evaluated.years for phase in year.crop.phases if phase.id in self.g.revenue}):
            revenue = self.g.revenue[phase_id]
            recent = revenue.yields.recent()
            out.append({"id": f"{evaluated.id}-yield-{phase_id}", "kind": "yield_history", "title": f"Reported {phase_id.replace('_', ' ')} yield",
                        "summary": ("The yield you entered." if revenue.dataset_id is None else
                                    f"The {revenue.yields.level}'s reported average yield over its last {len(recent)} reported years."),
                        "quantity": quantity(float(recent.mean()), revenue.yields.unit.lower().replace(" / ", "/"), kind=EvidenceKind.GROUND,
                                             tier=AccessTier.SNAPSHOT if revenue.dataset_id == "faostat" else AccessTier.LIVE,
                                             datasets=[revenue.dataset_id] if revenue.dataset_id else [], low=float(recent.min()), high=float(recent.max()), period=revenue.yields.period,
                                             n_valid=len(revenue.yields.values), n_expected=int(revenue.yields.period[1][:4]) - int(revenue.yields.period[0][:4]) + 1, needs_local=True),
                        "series_id": None})
        return out

    def rotation(self, evaluated: Evaluated, current: Evaluated, rank: int | None, first_share: float | None) -> dict:
        gaps, reviews = self.rotation_gaps(evaluated, current)
        years = [{"cycle_year": index + 1, "crop_id": year.crop.id, "crop_name": year.crop.name, "cover_crop_id": year.cover.id if year.cover else None}
                 for index, year in enumerate(evaluated.years)]
        baseline = None
        if evaluated is current:
            share = None
            if self.baseline.source == "cdl_derived":
                share = consistency_quantity(self.baseline)
            confirmed = self.baseline.source == "farmer_supplied" or bool(self.request["farmer"].get("current_rotation_confirmed"))
            baseline = {"baseline_source": self.baseline.source, "farmer_confirmed": confirmed, "share_of_years_consistent": share,
                        "detection_basis": self.baseline.basis, "observed_years": observed_years(self.baseline)}
        total = evaluated.overall
        overall = {"value": None, "low": None, "high": None, "rank": rank, "rank_stability": {"share_ranked_first": first_share, "n_runs": self.draws.n},
                   "null_explanation": None if total is not None else self.unranked or "No score could be worked out for this rotation."}
        if total is not None:
            median, low, high = _pct(total)
            overall.update(value=round(median, 1), low=round(low, 1), high=round(high, 1))
        return {"id": evaluated.id, "role": evaluated.role, "change_level": evaluated.change_level, "label": rotations.label(evaluated.years), "years": years,
                "crops_per_year": round(rotations.crops_per_year(evaluated.years), 2),
                "baseline": baseline, "crop_fit": self.crop_fit(evaluated), "cover_calendar": self.cover_calendar(evaluated),
                "scores": [self.score(evaluated, score_id) for score_id in config.SCORE_ORDER],
                "overall": overall, "why_suggested": self.reasons(evaluated, current), "evidence": self.rotation_evidence(evaluated),
                "benefits": self.benefits(evaluated, current), "tradeoffs": [] if evaluated is current else self.tradeoffs(evaluated, current),
                "risk_calendar": self.risk_calendar(evaluated), "gaps": gaps, "local_review": reviews}
