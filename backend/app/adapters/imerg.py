"""Monthly satellite rainfall from NASA GPM IMERG (final run, version 07), one 10 km cell read per month."""

from __future__ import annotations

import calendar
import math
import re
import threading
from concurrent.futures import Future, ThreadPoolExecutor, wait
from datetime import date

from app.adapters.base import Fetcher, FetchError, SourceState
from app.core import config
from app.core.provenance import NullReason

SERVER = "https://gpm1.gesdisc.eosdis.nasa.gov/opendap/GPM_L3/GPM_3IMERGM.07"
CELL_DEGREES = 0.1
# The final run is published about four months behind.
PUBLICATION_LAG_MONTHS = 4
SETTLED_AFTER_MONTHS = 12
# The file server answers 503 to more than a few readers at once, so the readers are few and shared by every request.
_READERS = ThreadPoolExecutor(max_workers=4, thread_name_prefix="imerg")
_READING: dict[tuple, Future] = {}
_LOCK = threading.Lock()
VALUE = re.compile(r"precipitation\[0\]\[0\],\s*(-?[0-9.eE+-]+)")


def _month(fetcher: Fetcher, token: str, year: int, month: int, column: int, row: int, settled: bool) -> float | None:
    name = f"3B-MO.MS.MRG.3IMERG.{year}{month:02d}01-S000000-E235959.{month:02d}.V07B.HDF5"
    url = f"{SERVER}/{year}/{name}.ascii?precipitation%5B0%5D%5B{column}%5D%5B{row}%5D"
    try:
        text = fetcher.request("gpm_imerg", "GET", url, headers={"Authorization": f"Bearer {token}"}, max_age_days=None if settled else 7.0,
                               timeout=60 if settled else 20, attempts=4 if settled else 2).decode("utf-8", "replace")
    except FetchError:
        return None
    found = VALUE.search(text)
    if not found or float(found.group(1)) < 0:
        return None
    # The file holds the month's mean rate in millimetres an hour.
    return float(found.group(1)) * 24.0 * calendar.monthrange(year, month)[1]


def monthly_rain(fetcher: Fetcher, token: str | None, lon: float, lat: float, *, today: date,
                 wait_s: float = config.IMERG_WAIT_SECONDS) -> tuple[dict[str, float], SourceState]:
    """Millimetres of rain in each month since 2001, keyed YYYY-MM.

    The record is one file a month on a server that turns away more than a few readers at once, so a place never
    read before takes minutes. The reads go on in the background past `wait_s`; until every month is in, nothing
    is reported, and the next request for the place finds what has arrived since.
    """
    if not token:
        return {}, SourceState.not_configured("gpm_imerg")
    column, row = math.floor((lon + 180.0) / CELL_DEGREES), math.floor((lat + 90.0) / CELL_DEGREES)
    last = today.year * 12 + today.month - 1 - PUBLICATION_LAG_MONTHS
    wanted = [(index // 12, index % 12 + 1, last - index >= SETTLED_AFTER_MONTHS) for index in range(config.BASELINE_FIRST_YEAR * 12, last + 1)]
    with _LOCK:
        reads = {}
        for year, month, settled in wanted:
            key = (id(fetcher), column, row, year, month)
            read = _READING.get(key)
            if read is None:
                read = _READING[key] = _READERS.submit(_month, fetcher, token, year, month, column, row, settled)
            reads[(year, month)] = read
    for (year, month), read in reads.items():
        # A finished read is dropped from the shared table; its answer is in the fetch cache from then on.
        read.add_done_callback(lambda _, key=(id(fetcher), column, row, year, month): _READING.pop(key, None))
    _, still_reading = wait(reads.values(), timeout=wait_s)
    months = {f"{year}-{month:02d}": read.result() for (year, month), read in reads.items() if read.done() and read.result() is not None}
    missing = sum(1 for year, month, settled in wanted if settled and f"{year}-{month:02d}" not in months)
    if still_reading:
        return {}, SourceState("gpm_imerg", "failed", NullReason.FETCH_FAILED,
                               f"NASA's rainfall files for this place are still being read: {len(months)} of {len(wanted)} months are in. Run this again in a few minutes.")
    if missing:
        return {}, SourceState("gpm_imerg", "failed", NullReason.FETCH_FAILED,
                               f"{missing} of {len(wanted)} months of NASA's satellite rainfall could not be read. Other results are unaffected.")
    return months, SourceState.ok("gpm_imerg", period=(min(months) + "-01", max(months) + "-28"))
