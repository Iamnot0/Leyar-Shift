"""Today on the field: recent rain, soil wetness, the forecast and what the long record says to expect.

Nothing here feeds an analysis. Each part states its sources, and says why when it has nothing to give.
"""

from __future__ import annotations

import calendar
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

import numpy as np

from app.adapters import nass, places, weather
from app.adapters.base import FetchError, SourceState
from app.core import config
from app.core.provenance import NullReason
from app.modeling import analysis, crops, et0
from app.modeling.crops import Crop, CropLibrary, Phase
from app.modeling.engine import Context

REAL_RAIN_MM = config.DRY_SPELL_RAIN_MM
WEEK_DAYS = 7
MIN_YEARS = 10
MAX_ADVICE_CROPS = 4


def _part(state: SourceState | None, datasets: list[str], **values: Any) -> dict:
    available = state is None
    return {"available": available, "null_reason": None if available else state.null_reason.value, "null_explanation": None if available else state.message,
            "dataset_ids": datasets, **{name: value if available else (False if isinstance(value, bool) else [] if isinstance(value, list) else None) for name, value in values.items()}}


def _recent_rain(recent: weather.RecentRecord | None, state: SourceState) -> dict:
    empty = dict(last_7_days_mm=None, last_30_days_mm=None, last_real_rain_date=None, read_through=None)
    if recent is None:
        return _part(state, ["nasa_power"], **empty)
    known = np.nonzero(np.isfinite(recent.rain))[0]
    if known.size < 30:
        return _part(SourceState.insufficient("nasa_power", "The weather record has too few recent days for this place."), ["nasa_power"], **empty)
    last = int(known[-1])
    rain = np.nan_to_num(recent.rain[: last + 1])
    wet = np.nonzero(rain >= REAL_RAIN_MM)[0]
    return _part(None, ["nasa_power"], last_7_days_mm=round(float(rain[-7:].sum()), 1), last_30_days_mm=round(float(rain[-30:].sum()), 1),
                 last_real_rain_date=str(recent.dates[wet[-1]]) if wet.size else None, read_through=str(recent.dates[last]))


def _wetness(recent: weather.RecentRecord | None, state: SourceState, values: np.ndarray | None) -> dict:
    empty = dict(now=None, usual=None, usual_low=None, usual_high=None, read_on=None)
    if recent is None or values is None:
        return _part(state, ["nasa_power"], **empty)
    known = np.nonzero(np.isfinite(values))[0]
    if known.size == 0:
        return _part(SourceState.insufficient("nasa_power", "The weather record holds no soil wetness for this place."), ["nasa_power"], **empty)
    last = int(known[-1])
    months = recent.dates.astype("datetime64[M]").astype(int) % 12
    years = recent.dates.astype("datetime64[Y]").astype(int)
    earlier = values[(months == months[last]) & (years < years[last]) & np.isfinite(values)]
    usual = dict(usual=None, usual_low=None, usual_high=None)
    if earlier.size >= 28 * MIN_YEARS:
        usual = dict(usual=round(float(earlier.mean()), 2), usual_low=round(float(np.percentile(earlier, config.INTERVAL[1])), 2),
                     usual_high=round(float(np.percentile(earlier, config.INTERVAL[2])), 2))
    return _part(None, ["nasa_power"], now=round(float(values[last]), 2), **usual, read_on=str(recent.dates[last]))


def _week_water(days: list, state: SourceState, lat: float, elevation: float | None, today_doy: int) -> dict:
    if not days or elevation is None:
        reason = state if not state.available else SourceState.insufficient("meteomatics", "The forecast is too short to add up a week.")
        return _part(reason, ["meteomatics"], loss_mm=None, basis=None)
    week = days[:WEEK_DAYS]
    tmin = np.array([day.t_min_c for day in week])
    dew = np.maximum(np.array([day.dew_point_c for day in week]), tmin - config.REFERENCE_DEW_POINT_GAP_C)
    loss = et0.reference_et(np.array([day.t_max_c for day in week]), tmin, dew, np.array([day.wind_2m_ms for day in week]), np.array([day.solar_mj for day in week]),
                            np.array([float((today_doy + index - 1) % 365 + 1) for index in range(len(week))]), lat, elevation)
    return _part(None, ["meteomatics"], loss_mm=round(float(np.sum(loss)), 0),
                 basis="Worked out from the forecast temperature, humidity, wind and sunshine for a well-watered grass cover. A bare or dry field loses less.")


def _years_words(count: int, total: int) -> str:
    return f"In {count} of the last {total} years"


def _month_outlook(record: weather.WeatherRecord | None, state: SourceState, month: int) -> dict:
    empty = dict(month=None, rain_mm=None, rain_basis=None, coldest_night_c=None, coldest_night_basis=None, frost_share_of_years=None, frost_basis=None, usual_pattern=True)
    if record is None:
        return _part(state, ["nasa_power"], **empty)
    name = calendar.month_name[month]
    inside = record.months == month
    years = np.unique(record.years)
    rain = np.array([np.nansum(record.rain[inside & (record.years == year)]) for year in years])
    coldest = np.array([np.nanmin(record.tmin[inside & (record.years == year)]) for year in years])
    typical, night = float(np.median(rain)), float(np.median(coldest))
    frosty = int((coldest <= config.FROST_DAY_C).sum())
    return _part(None, ["nasa_power"], month=month, rain_mm=round(typical, 0),
                 rain_basis=f"{_years_words(int((rain < typical / 2).sum()), len(years))}, {name} brought less than half of that.",
                 coldest_night_c=round(night, 1), coldest_night_basis=f"The middle value of the coldest {name} night in each of {len(years)} years.",
                 frost_share_of_years=round(frosty / len(years), 2), frost_basis=f"{_years_words(frosty, len(years))}, {name} had at least one night at or below {config.FROST_DAY_C:g} °C.",
                 usual_pattern=True)


def _year_climate(record: weather.WeatherRecord | None, state: SourceState) -> dict:
    empty = dict(usual_rain_mm=None, dry_year_mm=None, interval=None, monthly_rain_mm=None, hot_days_per_year=None, frost_days_per_year=None, hottest_day_c=None,
                 coldest_night_c=None, record_years=None)
    if record is None:
        return _part(state, ["nasa_power"], **empty)
    years = np.unique(record.years)
    per_year = lambda values, how: np.array([how(values[record.years == year]) for year in years])  # noqa: E731
    rain = per_year(record.rain, np.nansum)
    monthly = [round(float(np.mean([np.nansum(record.rain[(record.months == month) & (record.years == year)]) for year in years])), 0) for month in range(1, 13)]
    return _part(None, ["nasa_power"], usual_rain_mm=round(float(np.median(rain)), 0), dry_year_mm=round(float(np.percentile(rain, config.INTERVAL[1])), 0),
                 interval=config.INTERVAL[0], monthly_rain_mm=monthly,
                 hot_days_per_year=round(float(np.median(per_year(record.tmax >= config.HEAT_DAY_C, np.sum))), 0),
                 frost_days_per_year=round(float(np.median(per_year(record.tmin <= config.FROST_DAY_C, np.sum))), 0),
                 hottest_day_c=round(float(np.median(per_year(record.tmax, np.nanmax))), 1), coldest_night_c=round(float(np.median(per_year(record.tmin, np.nanmin))), 1),
                 record_years=f"{int(years[0])} to {int(years[-1])}")


def _month_day(doy: int) -> str:
    stamp = date(2025, 1, 1) + timedelta(days=(doy - 1) % 365)
    return f"{stamp.day} {calendar.month_name[stamp.month]}"


@dataclass
class SowingWindow:
    """The stretch of the year in which a crop is sown here."""

    crop: Crop
    phase: Phase
    opens: int
    closes: int
    # True when the window is the state's own planting reports, false when it is a general reference date.
    reported: bool

    def holds(self, doy: int) -> bool:
        return (doy - self.opens) % 365 <= (self.closes - self.opens) % 365

    def words(self) -> str:
        if self.reported:
            return f"Farmers in your state plant most of it between {_month_day(self.opens)} and {_month_day(self.closes)}"
        return f"General reference tables put its planting around {_month_day(self.phase.plant_doy or self.opens)}"


def _sowing_windows(library: CropLibrary, place: places.Place, ctx: Context) -> list[SowingWindow]:
    grown = [(crop, crop.phases[0]) for crop in library.crops.values()
             if crop.category in ("cash", "forage") and len(crop.phases) == 1 and crop.phases[0].plant_doy is not None]
    key = ctx.settings.key("NASS_API_KEY")

    def reported(phase: Phase) -> tuple[int, int] | None:
        if not (key and place.conterminous_us and phase.nass):
            return None
        commodity, class_desc, _ = phase.nass
        named = nass.Commodity(commodity, class_desc if commodity == "WHEAT" else "ALL CLASSES")
        try:
            ends = [nass.progress_day(ctx.fetcher, key, named, "PCT PLANTED", place.state_fips, percent=share) for share in config.SOWING_WINDOW_PERCENTS]
        except FetchError:
            return None
        return None if None in ends else (int(round(ends[0][0]) - 1) % 365 + 1, int(round(ends[1][0]) - 1) % 365 + 1)

    with ThreadPoolExecutor(max_workers=6) as pool:
        spans = list(pool.map(lambda pair: reported(pair[1]), grown))
    half = config.SOWING_REFERENCE_HALF_WINDOW_DAYS
    return [SowingWindow(crop, phase, span[0], span[1], True) if span else
            SowingWindow(crop, phase, (phase.plant_doy - half - 1) % 365 + 1, (phase.plant_doy + half - 1) % 365 + 1, False)
            for (crop, phase), span in zip(grown, spans)]


def _advice(rows: list[tuple[int, dict]], windows: list[SowingWindow], datasets: list[str], action_for: Any) -> dict:
    rows.sort(key=lambda pair: (not pair[1]["good"], pair[0]))
    top = [row for _, row in rows[:MAX_ADVICE_CROPS]]
    reported = any(window.reported for window in windows)
    basis = "Planting dates are general reference values from FAO-56 table 11, not records for your district. "
    if reported:
        basis = "Planting dates are the weeks in which the middle 80% of your state's crop was planted, from USDA crop progress reports since 2015. "
        if not all(window.reported for window in windows):
            basis += "Crops the state does not report on use general reference dates, and say so. "
    return _part(None, datasets + (["nass_quickstats"] if reported else []), crops=top, action=action_for(top, [row["name"] for row in top if row["good"]]),
                 basis=basis + "The weather checks are simple rules of thumb. Check both against what works on your ground.", needs_local_judgment=True)


def _no_advice(state: SourceState, datasets: list[str]) -> dict:
    return _part(state, datasets, crops=[], action=None, basis=None, needs_local_judgment=False)


def _sow_this_week(windows: list[SowingWindow], today: date, days: list, forecast_state: SourceState, surface: dict, recent_rain: dict) -> dict:
    if not windows:
        return _no_advice(SourceState("nasa_power", "unavailable", NullReason.OUT_OF_COVERAGE, "No crop sowing calendar covers this region yet."), [])
    has_forecast, has_surface = bool(days), bool(surface["available"])
    if not (has_forecast or has_surface or recent_rain["available"]):
        return _no_advice(forecast_state, [])
    datasets = (["meteomatics"] if has_forecast else []) + (["nasa_power"] if has_surface or recent_rain["available"] else [])
    week = days[:WEEK_DAYS]
    coldest = min(day.t_min_c for day in week) if has_forecast else None
    frost_ahead = has_forecast and coldest <= config.FROST_DAY_C
    rain_ahead = sum(day.rain_mm for day in week) if has_forecast else None
    dry_topsoil = has_surface and surface["usual_low"] is not None and surface["now"] < surface["usual_low"]
    wet_topsoil = has_surface and surface["usual_high"] is not None and surface["now"] > surface["usual_high"]
    doy = today.timetuple().tm_yday

    rows: list[tuple[int, dict]] = []
    for window in windows:
        to_open, since_close = (window.opens - doy) % 365, (doy - window.closes) % 365
        when = window.words()
        if not window.holds(doy):
            if to_open <= config.SOWING_LOOKAHEAD_DAYS:
                verdict, good, reason = "Not yet", False, f"{when}, about {to_open} days from now."
            elif since_close <= config.SOWING_LOOKAHEAD_DAYS:
                verdict, good, reason = "Late", False, f"{when}. That was about {since_close} days ago, and late sowing carries more risk."
            else:
                verdict, good, reason = "Out of season", False, f"{when}."
        elif window.phase.spring_planted and frost_ahead:
            verdict, good, reason = "Wait for the frost to pass", False, f"{when}. But nights fall to {coldest:.0f} °C in the next 7 days."
        elif rain_ahead is not None and rain_ahead >= config.SOWING_TOO_WET_WEEK_MM:
            verdict, good, reason = "Too wet this week", False, f"{when}. But {rain_ahead:.0f} mm of rain is forecast this week, enough to seal the surface or flood the seed."
        elif wet_topsoil and (rain_ahead or 0.0) >= config.SOWING_WET_GROUND_MORE_RAIN_MM:
            verdict, good, reason = "Wait for drier ground", False, f"{when}. But the topsoil is wetter than usual for this month and more rain is forecast."
        elif dry_topsoil and (rain_ahead is None or rain_ahead < config.SOWING_DRY_WEEK_MM):
            verdict, good, reason = "Good time if you can water", True, f"{when}. The topsoil is drier than usual for this month and little rain is forecast, so the seed will need water."
        else:
            weather_words = f" Nights stay above {coldest:.0f} °C and {rain_ahead:.0f} mm of rain is forecast this week." if has_forecast else ""
            verdict, good, reason = "Good time", True, f"{when}.{weather_words}"
        rows.append((0 if window.holds(doy) else min(to_open, since_close), dict(crop_id=window.crop.id, name=window.crop.name, verdict=verdict, good=good, reason=reason)))

    def action(top: list[dict], good_names: list[str]) -> str:
        if good_names:
            return f"Check that the seedbed is firm and moist at seed depth before sowing {' or '.join(good_names[:2]).lower()}."
        if any(row["verdict"].startswith(("Wait", "Too wet")) for row in top):
            return "Hold off sowing this week and let the weather pass."
        if any(row["verdict"] == "Not yet" for row in top):
            return "Nothing to sow this week. Get seed and the planter ready for the window ahead."
        return "No main crop is in its sowing window. Keep stubble or cover on the soil until the next one."

    return _advice(rows, windows, datasets, action)


def _plant_this_month(windows: list[SowingWindow], next_month: int, month_outlook: dict) -> dict:
    if not windows:
        return _no_advice(SourceState("nasa_power", "unavailable", NullReason.OUT_OF_COVERAGE, "No crop calendar covers this region yet."), [])
    if not month_outlook["available"]:
        return _no_advice(SourceState("nasa_power", "unavailable", NullReason(month_outlook["null_reason"] or "not_configured"),
                                      month_outlook["null_explanation"] or "The long weather record is not available for next month."), ["nasa_power"])
    month_name = calendar.month_name[next_month]
    first = date(2025, next_month, 1).timetuple().tm_yday
    last = first + calendar.monthrange(2025, next_month)[1] - 1
    rain, coldest, frost_share = float(month_outlook["rain_mm"]), float(month_outlook["coldest_night_c"]), float(month_outlook["frost_share_of_years"])

    rows: list[tuple[int, dict]] = []
    for window in windows:
        when = window.words()
        to_open = (window.opens - last) % 365
        in_month = window.holds(first) or window.holds((last - 1) % 365 + 1) or (window.opens - first) % 365 <= last - first
        if not in_month:
            near = to_open <= config.SOWING_LOOKAHEAD_DAYS
            verdict, good, reason = ("Not yet", False, f"{when}, after {month_name}.") if near else ("Out of season", False, f"{when}.")
        elif window.phase.spring_planted and frost_share >= config.SOWING_FROST_SHARE_OF_YEARS:
            verdict, good, reason = "Frost risk", False, f"{when}. But {month_name} brings frost in about {round(frost_share * 10)} years out of 10, with nights near {coldest:.0f} °C."
        elif rain < config.SOWING_DRY_MONTH_MM:
            verdict, good, reason = "Good month if you can water", True, f"{when}. {month_name} usually brings only about {rain:.0f} mm of rain."
        else:
            verdict, good, reason = "Good month", True, f"{when}. {month_name} usually brings about {rain:.0f} mm of rain, with the coldest nights near {coldest:.0f} °C."
        rows.append((0 if in_month else to_open, dict(crop_id=window.crop.id, name=window.crop.name, verdict=verdict, good=good, reason=reason)))

    def action(top: list[dict], good_names: list[str]) -> str:
        if good_names:
            return f"Line up seed for {' or '.join(good_names[:2]).lower()}" + (" and a way to water it in." if rain < config.SOWING_DRY_MONTH_MM else f", and plan field work around {month_name}'s usual {rain:.0f} mm of rain.")
        if any(row["verdict"] == "Frost risk" for row in top):
            return f"Hold sowing through {month_name}'s frosts and get inputs ready for the next window."
        return f"No main crop is sown in {month_name}. Keep the soil covered and line up seed for the next window."

    return _advice(rows, windows, ["nasa_power"], action)


def build(lat: float, lon: float, ctx: Context) -> dict:
    with ThreadPoolExecutor(max_workers=4) as pool:
        power_f = pool.submit(weather.fetch_power, ctx.fetcher, lon, lat)
        recent_f = pool.submit(weather.fetch_recent, ctx.fetcher, lon, lat, today=ctx.today)
        forecast_f = pool.submit(analysis.forecast_days, lat, lon, ctx)
        place_f = pool.submit(places.locate, ctx.fetcher, lon, lat)
        record, record_state = power_f.result()
        recent, recent_state = recent_f.result()
        forecast = forecast_f.result()
        place = place_f.result()
    region, exact = crops.region_for(place.country_code, lat, place.conterminous_us)
    # Where no crop calendar is set up for the region, no sowing advice is given.
    windows = _sowing_windows(crops.load(region), place, ctx) if exact else []
    next_month = ctx.today.month % 12 + 1
    recent_rain = _recent_rain(recent, recent_state)
    soil_surface = _wetness(recent, recent_state, recent.wetness_surface if recent else None)
    soil_root_zone = _wetness(recent, recent_state, recent.wetness_root if recent else None)
    month_outlook = _month_outlook(record, record_state, next_month)
    return {"location": {"lat": lat, "lon": lon}, "as_of": ctx.today.isoformat(), "forecast": analysis.outlook(lat, lon, ctx, forecast),
            "recent_rain": recent_rain, "soil_surface": soil_surface, "soil_root_zone": soil_root_zone,
            "week_water": _week_water(forecast[0], forecast[2], lat, record.elevation if record else None, ctx.today.timetuple().tm_yday),
            "month_outlook": month_outlook, "year_climate": _year_climate(record, record_state),
            "sow_this_week": _sow_this_week(windows, ctx.today, forecast[0], forecast[2], soil_surface, recent_rain),
            "plant_this_month": _plant_this_month(windows, next_month, month_outlook)}
