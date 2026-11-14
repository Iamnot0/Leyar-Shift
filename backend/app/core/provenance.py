"""Evidence vocabulary, display labels, the dataset registry and the Quantity builders.

Display words are locked with development/design/DESIGN.md and served only through GET /v1/meta.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from app.core import config


class EvidenceKind(StrEnum):
    SATELLITE = "satellite_observation"
    GROUND = "ground_observation"
    SOIL_SURVEY = "soil_survey_baseline"
    MODEL = "model_output"


class AccessTier(StrEnum):
    LIVE = "live"
    SNAPSHOT = "snapshot"
    MODELED = "modeled"


class NullReason(StrEnum):
    OUT_OF_COVERAGE = "out_of_coverage"
    NOT_CONFIGURED = "not_configured"
    FETCH_FAILED = "fetch_failed"
    INSUFFICIENT = "insufficient_observations"


class Scope(StrEnum):
    GLOBAL = "global"
    US_ONLY = "us_only"
    WESTERN_US = "western_us"


EVIDENCE_LABELS = {
    EvidenceKind.SATELLITE: ("Satellite", "Measured from orbit over your area."),
    EvidenceKind.GROUND: ("Ground reading", "Measured or recorded on the ground near you."),
    EvidenceKind.SOIL_SURVEY: ("Soil survey baseline", "From the mapped soil survey. It describes the soil type, not this season."),
    EvidenceKind.MODEL: ("Model output", "Calculated, not measured. Always shown with its low-to-high range."),
}
ACCESS_LABELS = {
    AccessTier.LIVE: ("Live", "Fetched from the source for this request."),
    AccessTier.SNAPSHOT: ("Snapshot", "Read from a dated copy made in advance."),
    AccessTier.MODELED: ("Modeled", "Computed by this tool from the sources listed."),
}
NULL_LABELS = {
    NullReason.OUT_OF_COVERAGE: ("No coverage", "This source does not cover your location."),
    NullReason.NOT_CONFIGURED: ("Not set up", "This source is not set up in this version."),
    NullReason.INSUFFICIENT: ("Too few readings", "There were too few clear readings to say."),
    NullReason.FETCH_FAILED: ("Could not load", "The source did not answer. Your other results are unaffected."),
}
NEEDS_LOCAL_JUDGMENT = ("needs_local_judgment", "Check locally", "A farmer or agronomist should confirm this before relying on it.")

RISK_LEVEL_LABELS = (
    ("0", "Lower", f"The hazard came in fewer than {config.RISK_LEVEL_SHARES[0]:.0%} of years."),
    ("1", "Raised", f"The hazard came in {config.RISK_LEVEL_SHARES[0]:.0%} to {config.RISK_LEVEL_SHARES[1]:.0%} of years."),
    ("2", "High", f"The hazard came in {config.RISK_LEVEL_SHARES[1]:.0%} of years or more."),
)
COVER_STATE_LABELS = (
    ("crop", "Crop", "A harvested crop is growing."),
    ("cover_crop", "Cover crop", "A crop grown to protect the soil is growing."),
    ("residue", "Stubble", "Nothing is growing, but stubble or mulch covers the ground."),
    ("bare", "Bare", "Nothing is growing and the soil is uncovered."),
)
CALENDAR_HAZARD_LABELS = (
    ("frost", "Frost while a crop is vulnerable", f"Days at or below {config.FROST_DAY_C:g} °C while a crop is emerging or setting grain."),
    ("heat", "Heat while a crop is vulnerable", f"Days at or above {config.HEAT_DAY_C:g} °C while a crop is growing."),
    ("dry_spell", "Dry spell while a crop is growing", f"A run of 14 or more days with under {config.DRY_SPELL_RAIN_MM:g} mm of rain a day."),
    ("extreme_rain", "Heavy rain", "A day wetter than 95 in 100 rain days here."),
    ("bare_field", "Bare soil", "The soil is uncovered for most of the month."),
)
ZONE_HAZARD_LABELS = (
    ("erosion", "Erosion", "Where slope and soil make this field easier to erode, compared with the rest of the field."),
    ("water_stress", "Water stress", "Where the soil holds less water for crops, compared with the rest of the field."),
    ("heat", "Heat", "How often heat days come. One reading for the whole field."),
    ("frost", "Frost", "How often frost days come while crops are vulnerable. One reading for the whole field."),
)
PRIORITY_LABELS = (
    ("conserve_water", "Use less water", "Rotations that need less water rank higher."),
    ("build_soil", "Build soil health", "Rotations that keep roots and cover on the soil rank higher."),
    ("reduce_erosion", "Reduce erosion", "Rotations that leave less bare soil in the wettest months rank higher."),
    ("lower_weather_risk", "Lower the risk from bad weather", "Rotations that meet less heat and frost while growing rank higher."),
    ("break_pest_cycles", "Break pest cycles", "Rotations that change crop family more often rank higher."),
    ("income", "Income", "Rotations with higher gross revenue rank higher."),
)
EQUIPMENT_LABELS = (
    ("row_crop_planter", "Row-crop planter", "For corn, sorghum, soybeans, sunflower and cotton."),
    ("grain_drill", "Grain drill", "For wheat, small grains and most cover crops."),
    ("combine", "Combine", "For grain and oilseed harvest."),
    ("forage_harvester", "Forage harvester", "For silage."),
    ("hay_equipment", "Hay equipment", "Mower, rake and baler."),
    ("specialty_harvester", "Specialty harvester", "For cotton or rice."),
)
TRADEOFF_LABELS = (
    ("better", "Gives", "This rotation scores higher in nearly all runs."),
    ("worse", "Costs", "This rotation scores higher in almost no runs."),
    ("uncertain", "Too close to call", "The values differ but neither rotation wins consistently."),
    ("similar", "About the same", "No meaningful difference."),
    ("unknown", "Could not be compared", "One side has no value."),
)
CROP_FIT_STATUS_LABELS = (
    ("fits", "Fits", "The field's conditions suit this crop on this check."),
    ("strained", "Under strain", "The crop can be grown, but this condition works against it in many years."),
    ("does_not_fit", "Does not fit", "This condition rules the crop out in most years unless something changes."),
    ("unknown", "Cannot say", "The data needed for this check is missing."),
)
CROP_FIT_CHECK_LABELS = (
    ("season_length", "Season length",
     f"For crops sown after the last frost: fits when the frost-free season is at least {config.CROP_FIT_SEASON_MARGIN_DAYS:g} days longer than the crop needs, "
     f"does not fit when it is more than {config.CROP_FIT_SEASON_MARGIN_DAYS:g} days shorter, under strain in between."),
    ("heat", "Heat",
     f"Fits when fewer than {config.CROP_FIT_HEAT_DAYS:g} days a season reach {config.HEAT_DAY_C:g} °C while the crop grows, otherwise under strain. "
     "One threshold serves every crop, so this never rules a crop out by itself."),
    ("frost", "Frost",
     f"Fits when frost reaches the crop in a vulnerable stage in fewer than {config.CROP_FIT_FROST_SHARES[0]:.0%} of years, "
     f"does not fit at {config.CROP_FIT_FROST_SHARES[1]:.0%} of years or more, under strain in between."),
    ("water", "Water",
     "Compares the water the crop wants beyond rain with the supply the farmer stated. Rain-fed: fits up to "
     f"{config.CROP_FIT_WATER_MM['rain_fed'][0]:g} mm, does not fit above {config.CROP_FIT_WATER_MM['rain_fed'][1]:g} mm. Limited supply: the farmer's own allowance "
     f"if given (does not fit above one and a half times it), otherwise {config.CROP_FIT_WATER_MM['limited'][0]:g} and {config.CROP_FIT_WATER_MM['limited'][1]:g} mm. "
     f"Reliable supply: under strain above {config.CROP_FIT_WATER_MM['reliable'][0]:g} mm."),
)
LAYER_KIND_LABELS = (
    ("picture", "Picture", "Shows the ground as a camera would."),
    ("data", "Data map", "Colours a measurement. Read it with its legend."),
)
DETECTION_BASIS_LABELS = (
    ("repeating_cycle", "Repeats cleanly", "The recent years on the crop map repeat this sequence."),
    ("recent_years", "No clean cycle", "Nothing repeats cleanly on the crop map, so the best-matching recent years are used. Please check."),
)
JOB_STAGES = (
    ("reading_field", "Reading the field boundary"),
    ("checking_coverage", "Checking which sources cover this field"),
    ("fetching_weather", "Fetching rainfall and temperature history"),
    ("fetching_soil", "Fetching soil and terrain"),
    ("fetching_crop_history", "Reading the crop history"),
    ("fetching_vegetation", "Reading recent satellite pictures"),
    ("fetching_water", "Fetching groundwater and soil moisture"),
    ("building_rotations", "Building rotations to compare"),
    ("scoring", "Scoring each rotation"),
    ("quantifying_uncertainty", "Working out how sure the comparison is"),
)
DISCLAIMER = (
    "Leyar Shift supports your judgment. It does not replace it, or your local agronomist. "
    "Every figure names its source, and every strategy lists what to check locally before you decide."
)


@dataclass(frozen=True)
class DatasetSpec:
    id: str
    name: str
    provider: str
    role: str
    scope: Scope
    evidence_kind: EvidenceKind
    tier: AccessTier
    native_resolution_m: float | None
    source_url: str
    configured: bool = True
    # Map pictures only: never an input to the analysis, so never listed among its sources.
    context_only: bool = False


def _spec(*args: Any, **kwargs: Any) -> DatasetSpec:
    return DatasetSpec(*args, **kwargs)


DATASETS: dict[str, DatasetSpec] = {
    spec.id: spec
    for spec in (
        _spec("nasa_power", "NASA POWER daily weather", "NASA Langley Research Center", "Daily temperature, rain, wind and sunshine since 2001",
              Scope.GLOBAL, EvidenceKind.MODEL, AccessTier.LIVE, 55000, "https://power.larc.nasa.gov/"),
        _spec("era5_open_meteo", "ERA5 reanalysis", "ECMWF, served by Open-Meteo", "A second, independent rainfall record",
              Scope.GLOBAL, EvidenceKind.MODEL, AccessTier.LIVE, 25000, "https://open-meteo.com/en/docs/historical-weather-api"),
        _spec("sentinel2", "Sentinel-2 Level-2A", "ESA Copernicus, served by Microsoft Planetary Computer", "How green the field was on each clear pass",
              Scope.GLOBAL, EvidenceKind.SATELLITE, AccessTier.LIVE, 10, "https://planetarycomputer.microsoft.com/dataset/sentinel-2-l2a"),
        _spec("modis_vegetation", "MODIS Terra vegetation index, 16-day", "NASA LP DAAC, served by Microsoft Planetary Computer",
              "How green the field got in each year since 2001", Scope.GLOBAL, EvidenceKind.SATELLITE, AccessTier.LIVE, 250,
              "https://planetarycomputer.microsoft.com/dataset/modis-13Q1-061"),
        _spec("nasadem", "NASADEM elevation", "NASA JPL, served by Microsoft Planetary Computer", "Slope of the field",
              Scope.GLOBAL, EvidenceKind.SATELLITE, AccessTier.LIVE, 30, "https://planetarycomputer.microsoft.com/dataset/nasadem"),
        _spec("usda_cdl", "Cropland Data Layer", "USDA NASS", "Which crop covered the field each year since 2008",
              Scope.US_ONLY, EvidenceKind.SATELLITE, AccessTier.LIVE, 30, "https://nassgeodata.gmu.edu/CropScape/"),
        _spec("ssurgo", "SSURGO soil survey", "USDA NRCS", "Soil texture, water holding and erodibility",
              Scope.US_ONLY, EvidenceKind.SOIL_SURVEY, AccessTier.LIVE, 10, "https://sdmdataaccess.sc.egov.usda.gov/"),
        _spec("soilgrids", "SoilGrids 2.0", "ISRIC World Soil Information", "Predicted soil properties where no soil survey is available",
              Scope.GLOBAL, EvidenceKind.SOIL_SURVEY, AccessTier.LIVE, 250, "https://soilgrids.org/"),
        _spec("usgs_groundwater", "USGS groundwater levels", "US Geological Survey", "Measured depth to water in nearby wells",
              Scope.US_ONLY, EvidenceKind.GROUND, AccessTier.LIVE, None, "https://api.waterdata.usgs.gov/"),
        _spec("nass_quickstats", "NASS QuickStats", "USDA NASS", "Reported yields, prices and planting dates",
              Scope.US_ONLY, EvidenceKind.GROUND, AccessTier.LIVE, None, "https://quickstats.nass.usda.gov/"),
        _spec("grace_fo", "GRACE and GRACE-FO water storage", "NASA JPL, PO.DAAC", "Change in total water stored under the region since 2002",
              Scope.GLOBAL, EvidenceKind.SATELLITE, AccessTier.SNAPSHOT, 300000, "https://podaac.jpl.nasa.gov/dataset/TELLUS_GRAC-GRFO_MASCON_CRI_GRID_RL06.3_V4", configured=False),
        _spec("smap_l4", "SMAP Level-4 root-zone soil moisture", "NASA, NSIDC DAAC", "Soil moisture in the root zone since 2015",
              Scope.GLOBAL, EvidenceKind.MODEL, AccessTier.SNAPSHOT, 9000, "https://nsidc.org/data/spl4smgp", configured=False),
        _spec("gpm_imerg", "GPM IMERG rainfall", "NASA GES DISC", "Rain each month since 2001, measured from satellites",
              Scope.GLOBAL, EvidenceKind.SATELLITE, AccessTier.LIVE, 10000, "https://gpm.nasa.gov/data/imerg"),
        _spec("gldas", "GLDAS land data assimilation", "NASA GES DISC", "Modeled soil moisture and evaporation. NASA POWER is used instead.",
              Scope.GLOBAL, EvidenceKind.MODEL, AccessTier.SNAPSHOT, 25000, "https://ldas.gsfc.nasa.gov/gldas", configured=False),
        _spec("nldas", "NLDAS land data assimilation", "NASA GES DISC", "Modeled soil moisture for North America. NASA POWER is used instead.",
              Scope.US_ONLY, EvidenceKind.MODEL, AccessTier.SNAPSHOT, 12500, "https://ldas.gsfc.nasa.gov/nldas", configured=False),
        _spec("openet", "OpenET evapotranspiration", "OpenET", "Water leaving the field each month, worked out from Landsat pictures",
              Scope.US_ONLY, EvidenceKind.MODEL, AccessTier.LIVE, 30, "https://openetdata.org/"),
        _spec("ecostress", "ECOSTRESS evapotranspiration", "NASA JPL, LP DAAC", "Water the crops used and surface heat at 70 m",
              Scope.GLOBAL, EvidenceKind.SATELLITE, AccessTier.SNAPSHOT, 70, "https://ecostress.jpl.nasa.gov/data", configured=False),
        _spec("faostat", "FAOSTAT crop yields and producer prices", "FAO", "Each country's reported yield and farm price for a crop, year by year",
              Scope.GLOBAL, EvidenceKind.GROUND, AccessTier.SNAPSHOT, None, "https://www.fao.org/faostat/en/#data"),
        _spec("hls_s30", "Harmonized Landsat Sentinel-2, Sentinel-2 pictures", "NASA LP DAAC, served by NASA GIBS", "Recent map picture",
              Scope.GLOBAL, EvidenceKind.SATELLITE, AccessTier.LIVE, 30, "https://lpdaac.usgs.gov/products/hlss30v002/", context_only=True),
        _spec("hls_l30", "Harmonized Landsat Sentinel-2, Landsat pictures", "NASA LP DAAC, served by NASA GIBS", "Recent map picture",
              Scope.GLOBAL, EvidenceKind.SATELLITE, AccessTier.LIVE, 30, "https://lpdaac.usgs.gov/products/hlsl30v002/", context_only=True),
        _spec("landsat_weld", "Landsat WELD annual composite", "NASA, served by NASA GIBS", "Cloud-free map picture from the year 2000",
              Scope.GLOBAL, EvidenceKind.SATELLITE, AccessTier.LIVE, 30, "https://gibs.earthdata.nasa.gov/", context_only=True),
        _spec("modis_terra", "MODIS Terra corrected reflectance", "NASA, served by NASA GIBS", "Daily map picture",
              Scope.GLOBAL, EvidenceKind.SATELLITE, AccessTier.LIVE, 250, "https://gibs.earthdata.nasa.gov/", context_only=True),
        _spec("meteomatics", "Meteomatics weather forecast", "Meteomatics AG", "Ten-day weather outlook",
              Scope.GLOBAL, EvidenceKind.MODEL, AccessTier.LIVE, None, "https://www.meteomatics.com/en/weather-api/", context_only=True),
        _spec("usgs_aerial", "USGS aerial imagery", "USDA and USGS The National Map", "Sharp map picture, ready-made tiles",
              Scope.US_ONLY, EvidenceKind.SATELLITE, AccessTier.LIVE, 2, "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer", context_only=True),
        _spec("usgs_naip", "USDA NAIP aerial photo", "USDA, served by USGS The National Map", "Full-detail map picture, rendered on request",
              Scope.US_ONLY, EvidenceKind.SATELLITE, AccessTier.LIVE, 0.6, "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer", context_only=True),
        _spec("sentinel2_cloudless", "Sentinel-2 cloudless 2025", "EOX IT Services GmbH", "Cloud-free map picture",
              Scope.GLOBAL, EvidenceKind.SATELLITE, AccessTier.LIVE, 10, "https://s2maps.eu/", context_only=True),
    )
}

NOT_CONFIGURED_MESSAGES = {
    "meteomatics": "The forecast service needs a Meteomatics login, which is not set. Nothing else depends on it.",
    "gpm_imerg": "IMERG needs a NASA Earthdata login, which is not set. Rainfall comes from NASA POWER and ERA5.",
    "gldas": "GLDAS needs an approval on the NASA Earthdata account that has not been given. NASA POWER is used instead.",
    "nldas": "NLDAS needs an approval on the NASA Earthdata account that has not been given. NASA POWER is used instead.",
    "openet": "OpenET needs its own key, which is not set. The water crops need comes from the water model alone.",
    "ecostress": "ECOSTRESS has not been loaded for this location in this version.",
    "grace_fo": "GRACE water storage is not used in this version. Where the United States has wells nearby, their measured water levels are shown instead.",
    "smap_l4": "SMAP soil moisture is not used in this version. Soil moisture comes from NASA POWER.",
}


def quantity(
    value: float | None,
    unit: str,
    *,
    kind: EvidenceKind,
    tier: AccessTier,
    datasets: list[str],
    low: float | None = None,
    high: float | None = None,
    period: tuple[str, str] | None = None,
    n_valid: int | None = None,
    n_expected: int | None = None,
    note: str | None = None,
    needs_local: bool = False,
    digits: int = 2,
) -> dict[str, Any]:
    """A value with its provenance. Modeled values must come with a range."""
    if value is None:
        raise ValueError("use missing() for a value that could not be computed")
    if kind is EvidenceKind.MODEL and (low is None or high is None):
        low = high = value
    resolutions = [DATASETS[d].native_resolution_m for d in datasets if DATASETS[d].native_resolution_m]
    return {
        "value": round(float(value), digits),
        "unit": unit,
        "low": None if low is None else round(float(low), digits),
        "high": None if high is None else round(float(high), digits),
        "evidence_kind": kind.value,
        "access_tier": tier.value,
        "dataset_ids": list(datasets),
        "native_resolution_m": max(resolutions) if resolutions else None,
        "period": None if period is None else {"start": period[0], "end": period[1]},
        "n_valid_obs": n_valid,
        "n_expected_obs": n_expected,
        "null_reason": None,
        "null_explanation": None,
        "retryable": False,
        "needs_local_judgment": needs_local,
        "note": note,
    }


def missing(unit: str, reason: NullReason, explanation: str, *, datasets: list[str] | None = None) -> dict[str, Any]:
    """A value that could not be computed, with the reason in plain words."""
    return {
        "value": None,
        "unit": unit,
        "low": None,
        "high": None,
        "evidence_kind": None,
        "access_tier": None,
        "dataset_ids": list(datasets or []),
        "native_resolution_m": None,
        "period": None,
        "n_valid_obs": None,
        "n_expected_obs": None,
        "null_reason": reason.value,
        "null_explanation": explanation,
        "retryable": reason is NullReason.FETCH_FAILED,
        "needs_local_judgment": False,
        "note": None,
    }
