"""The date where a field is, so 'today' and the forecast's days are the farmer's, not the server's."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta


def local_offset(lon: float) -> timedelta:
    """Hours from UTC by longitude, 15 degrees an hour. Within an hour of the civil time zone almost everywhere."""
    return timedelta(hours=round(lon / 15.0))


def local_today(lon: float | None, now: datetime | None = None) -> date:
    moment = now or datetime.now(UTC)
    return (moment + local_offset(lon)).date() if lon is not None else moment.date()
