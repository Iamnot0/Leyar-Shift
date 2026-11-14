"""Settings, scenario thresholds and scoring conventions. The only place these are defined."""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_ROOT.parent

CONTRACT_VERSION = "0.3.7"

BASELINE_FIRST_YEAR = 2001
BASELINE_LAST_YEAR = 2025
CROP_HISTORY_FIRST_YEAR = 2008
CROP_HISTORY_LAST_YEAR = 2025
VEGETATION_FIRST_YEAR = 2023

GRID_CELL_M = 30.0
FIELD_AREA_MIN_HA = 0.5
FIELD_AREA_MAX_HA = 2000.0

UNCERTAINTY_RUNS = 500
INTERVAL = ("p10_p90", 10.0, 90.0)

# Rainfall scenarios restrict the weather-year draw to the site's own driest years.
RAINFALL_SCENARIOS = {
    "normal": {"label": "Normal", "driest_share": 1.0, "definition": "Any year from the 2001 to 2025 record."},
    "dry": {"label": "Dry", "driest_share": 0.2, "definition": "A dry year that comes about one year in five here."},
    "very_dry": {"label": "Very dry", "driest_share": 0.1, "definition": "A very dry year that comes about one year in ten here."},
}
# Temperature scenarios shift every day of the record. They are what-if cases, not forecasts.
TEMPERATURE_SCENARIOS = {
    "normal": {"label": "Normal", "shift_c": 0.0, "definition": "Temperatures as recorded, 2001 to 2025."},
    "warm": {"label": "Warm", "shift_c": 1.0, "definition": "Every day 1 °C warmer than recorded."},
    "hot": {"label": "Hot", "shift_c": 2.0, "definition": "Every day 2 °C warmer than recorded."},
}

HEAT_DAY_C = 35.0
OUTLOOK_DAYS = 10
# How long an analysis waits for the monthly satellite rainfall before going on without it.
IMERG_WAIT_SECONDS = 30.0
FROST_DAY_C = 0.0
# Reference evaporation assumes watered grass, where the dew point stays within about 2 °C of the night minimum.
# A record from dry land is held to that gap before use (FAO-56 Annex 6, equation 6-6).
REFERENCE_DEW_POINT_GAP_C = 2.0
DRY_SPELL_RAIN_MM = 1.0
HEAVY_RAIN_PERCENTILE = 95.0

# Risk level 1 from this share of years, level 2 from the second.
RISK_LEVEL_SHARES = (0.2, 0.5)

TRADEOFF_BETTER_SHARE = 0.9
TRADEOFF_WORSE_SHARE = 0.1
TRADEOFF_SIMILAR_DELTA = 2.0
# The first-ranked rotation is a clear best fit only when it outscores the runner-up in at least this share of the paired runs.
CLOSE_CALL_SHARE = 0.75

# Rank-order-centroid weights turn the farmer's ranking into weights that sum to one.
PRIORITY_TO_SCORE = {
    "conserve_water": "water_balance",
    "build_soil": "soil_health",
    "reduce_erosion": "erosion",
    "lower_weather_risk": "climate_risk",
    "break_pest_cycles": "pest_break",
    "income": "economics",
}
SCORE_ORDER = ("water_balance", "soil_health", "erosion", "climate_risk", "pest_break", "economics")

# A score is 100 at `best` and 0 at `worst`, linear between. These are conventions, not measurements.
SCORE_ANCHORS = {
    "water_balance": {"best": 0.0, "worst": 600.0, "unit": "mm/yr"},
    "erosion": {"best": 0.0, "worst": 13.0, "unit": "weeks/yr"},
    "climate_risk": {"best": 0.0, "worst": 60.0, "unit": "days/yr"},
    "pest_break": {"best": 1.0, "worst": 4.0, "unit": "years"},
}

# A year counts as less green than usual when its greenest point is under this share of the field's typical peak.
LOW_GREENNESS_SHARE = 0.85
GREENNESS_MIN_COMPOSITES = 18

WELL_SEARCH_RADIUS_KM = 25.0
WELL_MIN_YEARS = 8
TREND_FLAT_SHARE = 0.05

LOCALLY_GROWN_MIN_SHARE = 0.01

# Crop-fit conventions: where each check moves from "fits" to "strained" to "does not fit".
CROP_FIT_SEASON_MARGIN_DAYS = 20.0
CROP_FIT_HEAT_DAYS = 10.0
CROP_FIT_FROST_SHARES = (0.2, 0.6)
# Water a crop may need beyond rain before the farmer's stated supply is strained, then exceeded, mm a season.
CROP_FIT_WATER_MM = {"rain_fed": (50.0, 250.0), "limited": (250.0, 500.0), "reliable": (600.0, None)}

# Likely crop failure, counted per weather year as CropSuite counts its recurrence rate of potential crop failure
# (Zabel, Knüttel and Poschlod 2025, Geosci. Model Dev. 18, 1067-1087). The rules are in app/modeling/failure.py.
# The killing frost FAO-56 Table 11 uses for alfalfa; Kansas State's C-646 puts severe injury to jointing wheat at -4 °C for two hours.
KILLING_FROST_C = -4.0
# Above every crop's critical flowering temperature, 34 to 39 °C (Gourdji, Sibley and Lobell 2013, Environ. Res. Lett. 8, 024041).
FAILURE_HEAT_C = 40.0
# A convention: a sustained spell, not one hot afternoon.
FAILURE_HEAT_SPELL_DAYS = 5
# A convention: more than half of the yield the crop would give unstressed is lost to water shortage (FAO-33 relative yield).
FAILURE_RELATIVE_YIELD = 0.5
# "Likely": at least this share of the runs that harvest the crop in a weather year fail in it.
FAILURE_RUN_SHARE = 0.5


# Sowing advice. The window is the weeks in which the middle of the state's crop went in, from USDA progress reports.
SOWING_WINDOW_PERCENTS = (10.0, 90.0)
# Where no state reports exist, a general reference date stands in, taken this many days either side.
SOWING_REFERENCE_HALF_WINDOW_DAYS = 21
SOWING_LOOKAHEAD_DAYS = 45
# The weather rules below are plain conventions, not agronomic standards; the advice is always flagged for local judgment.
SOWING_TOO_WET_WEEK_MM = 50.0
SOWING_WET_GROUND_MORE_RAIN_MM = 10.0
SOWING_DRY_WEEK_MM = 5.0
SOWING_DRY_MONTH_MM = 20.0
SOWING_FROST_SHARE_OF_YEARS = 0.4

# Income outside the United States: the latest years in which a country reported both a yield and a farm price.
INCOME_RECENT_YEARS = 5
INCOME_MIN_YEARS = 3
# A price last reported longer ago than this is too old to put a money figure on.
INCOME_PRICE_MAX_AGE_YEARS = 6

# The language model that may word the reasoning summary. It is given facts only and its reply is checked against them.
SUMMARY_MODEL = "openai/gpt-4o-mini"
SUMMARY_TIMEOUT_S = 8.0

# Real requests allowed to the metered sources, kept under what each account permits.
OPENET_REQUESTS_PER_MONTH = 90
METEOMATICS_REQUESTS_PER_DAY = 900
# Requests one client may make in a minute to the routes that fetch or compute. Polling a job and the health check are free.
RATE_LIMIT_PER_MINUTE = 60


@lru_cache
def engine_fingerprint() -> str:
    """Changes whenever the engine's code or crop table changes, so a stored result is never served by a different engine."""
    digest = hashlib.sha256()
    for path in sorted((BACKEND_ROOT / "app").rglob("*")):
        if path.suffix in (".py", ".csv") and "schemas" not in path.parts:
            digest.update(path.relative_to(BACKEND_ROOT).as_posix().encode())
            digest.update(path.read_bytes())
    return digest.hexdigest()[:16]


def _repo_path(*parts: str) -> Path:
    direct = REPO_ROOT.joinpath(*parts)
    return direct if direct.exists() else REPO_ROOT.joinpath("development", *parts)


@dataclass(frozen=True)
class Settings:
    contract_path: Path = BACKEND_ROOT / "openapi.yaml"
    processed_dir: Path = BACKEND_ROOT / "data"
    var_dir: Path = BACKEND_ROOT / "var"
    keys_file: Path = field(default_factory=lambda: _repo_path("apikeys.md"))
    cors_origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173")
    fetch_mode: str = "live"
    rate_limit_per_minute: int = RATE_LIMIT_PER_MINUTE
    recordings_dir: Path | None = None
    keys: dict[str, str] = field(default_factory=dict)

    @property
    def http_cache_dir(self) -> Path:
        return self.recordings_dir or self.var_dir / "cache" / "http"

    @property
    def jobs_dir(self) -> Path:
        return self.var_dir / "jobs"

    @property
    def allowances_dir(self) -> Path:
        return self.var_dir / "allowances"

    def key(self, name: str) -> str | None:
        return os.environ.get(name) or self.keys.get(name)


def _read_keys(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    keys = {}
    for line in path.read_text().splitlines():
        name, sep, value = line.strip().partition("=")
        if sep and name.isidentifier() and value:
            keys[name] = value.strip()
    return keys


@lru_cache
def get_settings() -> Settings:
    recordings = os.environ.get("FIELDSHIFT_RECORDINGS_DIR")
    var_dir = Path(os.environ.get("FIELDSHIFT_VAR_DIR", BACKEND_ROOT / "var"))
    keys_file = _repo_path("apikeys.md")
    return Settings(
        var_dir=var_dir,
        fetch_mode=os.environ.get("FIELDSHIFT_FETCH_MODE", "live"),
        rate_limit_per_minute=int(os.environ.get("FIELDSHIFT_RATE_LIMIT_PER_MINUTE", RATE_LIMIT_PER_MINUTE)),
        recordings_dir=Path(recordings) if recordings else None,
        keys=_read_keys(keys_file),
    )
