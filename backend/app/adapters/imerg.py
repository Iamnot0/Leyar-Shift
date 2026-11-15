"""Monthly satellite rainfall from NASA GPM IMERG (final run, version 07) for one 10 km cell, through NASA Giovanni."""

from __future__ import annotations

import calendar
from datetime import date

from app.adapters import giovanni
from app.adapters.base import Fetcher, FetchError, SourceState
from app.core import config

VARIABLE = "GPM_3IMERGM_07_precipitation"


def monthly_rain(fetcher: Fetcher, token: str | None, lon: float, lat: float, *, today: date) -> tuple[dict[str, float], SourceState]:
    """Millimetres of rain in each month since 2001, keyed YYYY-MM. Giovanni returns the whole record in one answer."""
    if not token:
        return {}, SourceState.not_configured("gpm_imerg")
    try:
        series = giovanni.monthly(fetcher, "gpm_imerg", token, VARIABLE, lon, lat, config.BASELINE_FIRST_YEAR, today.year, max_age_days=7.0)
    except FetchError as error:
        return {}, SourceState.failed("gpm_imerg", error)
    # Each value is the month's mean rate in millimetres an hour.
    months = {key: value * 24.0 * calendar.monthrange(int(key[:4]), int(key[5:]))[1] for key, value in series.values.items() if value >= 0}
    if not months:
        return {}, SourceState.out_of_coverage("gpm_imerg", "GPM IMERG has no rainfall for this location.")
    return months, SourceState.ok("gpm_imerg", period=(min(months) + "-01", max(months) + "-28"))
