# Generated from backend/openapi.yaml by datamodel-codegen. Regenerate; do not edit by hand.

from __future__ import annotations

from datetime import date as date_aliased
from enum import Enum, IntEnum, StrEnum
from typing import Literal

from pydantic import AnyUrl, AwareDatetime, BaseModel, Field, RootModel


class EvidenceKind(StrEnum):
    """
    What a value is. Drawn differently by the client.
    """

    satellite_observation = 'satellite_observation'
    ground_observation = 'ground_observation'
    soil_survey_baseline = 'soil_survey_baseline'
    model_output = 'model_output'


class AccessTier(StrEnum):
    """
    How the value was obtained. `live` was fetched from the source for this request. `snapshot`
    comes from a dated, pre-ingested regional copy. `modeled` was computed by this system.

    """

    live = 'live'
    snapshot = 'snapshot'
    modeled = 'modeled'


class NullReason(StrEnum):
    """
    Why a value is missing. `out_of_coverage` is displayed as "No coverage". Only `fetch_failed`
    is worth retrying.

    """

    out_of_coverage = 'out_of_coverage'
    not_configured = 'not_configured'
    fetch_failed = 'fetch_failed'
    insufficient_observations = 'insufficient_observations'


class CoverageScope(StrEnum):
    global_ = 'global'
    us_only = 'us_only'
    western_us = 'western_us'


class DatasetStatus(StrEnum):
    available = 'available'
    unavailable = 'unavailable'
    failed = 'failed'


class ScoreId(StrEnum):
    water_balance = 'water_balance'
    soil_health = 'soil_health'
    erosion = 'erosion'
    climate_risk = 'climate_risk'
    pest_break = 'pest_break'
    economics = 'economics'


class Priority(StrEnum):
    """
    Farmer priority. Each maps to one score, in the same order as `ScoreId`.
    """

    conserve_water = 'conserve_water'
    build_soil = 'build_soil'
    reduce_erosion = 'reduce_erosion'
    lower_weather_risk = 'lower_weather_risk'
    break_pest_cycles = 'break_pest_cycles'
    income = 'income'


class WaterAvailability(StrEnum):
    rain_fed = 'rain_fed'
    limited = 'limited'
    reliable = 'reliable'


class Equipment(StrEnum):
    row_crop_planter = 'row_crop_planter'
    grain_drill = 'grain_drill'
    combine = 'combine'
    forage_harvester = 'forage_harvester'
    hay_equipment = 'hay_equipment'
    specialty_harvester = 'specialty_harvester'


class RainfallScenario(StrEnum):
    normal = 'normal'
    dry = 'dry'
    very_dry = 'very_dry'


class TemperatureScenario(StrEnum):
    normal = 'normal'
    warm = 'warm'
    hot = 'hot'


class ZoneHazard(StrEnum):
    erosion = 'erosion'
    water_stress = 'water_stress'
    heat = 'heat'
    frost = 'frost'


class CalendarHazard(StrEnum):
    frost = 'frost'
    heat = 'heat'
    dry_spell = 'dry_spell'
    extreme_rain = 'extreme_rain'
    bare_field = 'bare_field'


class RiskLevel(IntEnum):
    """
    0 lower, 1 raised, 2 high. Thresholds are in `Meta.risk_levels`.
    """

    integer_0 = 0
    integer_1 = 1
    integer_2 = 2


class CoverState(StrEnum):
    """
    `residue` is ground covered by stubble or mulch with nothing growing. It is not bare soil.

    """

    crop = 'crop'
    cover_crop = 'cover_crop'
    residue = 'residue'
    bare = 'bare'


class CropCategory(StrEnum):
    cash = 'cash'
    forage = 'forage'
    cover = 'cover'
    fallow = 'fallow'


class JobStatus(StrEnum):
    queued = 'queued'
    running = 'running'
    done = 'done'
    error = 'error'


class DetectionBasis(StrEnum):
    """
    `repeating_cycle`: the recent years repeat this sequence cleanly. `recent_years`: nothing
    repeats cleanly, so the best-matching recent sequence is used and the farmer should check it.

    """

    repeating_cycle = 'repeating_cycle'
    recent_years = 'recent_years'


class CropFitStatus(StrEnum):
    fits = 'fits'
    strained = 'strained'
    does_not_fit = 'does_not_fit'
    unknown = 'unknown'


class CropFitCheckId(StrEnum):
    season_length = 'season_length'
    heat = 'heat'
    frost = 'frost'
    water = 'water'


class LayerKind(StrEnum):
    """
    `picture` shows the ground as a camera would. `data` colours a measurement, such as soil
    moisture, and needs its legend.

    """

    picture = 'picture'
    data = 'data'


class Position(RootModel[list[float]]):
    """
    Longitude, latitude.
    """

    root: list[float] = Field(
        ..., description='Longitude, latitude.', max_length=2, min_length=2
    )


class LinearRing(RootModel[list[Position]]):
    root: list[Position] = Field(..., min_length=4)


class Polygon(BaseModel):
    type: Literal['Polygon']
    coordinates: list[LinearRing] = Field(..., min_length=1)


class Coordinate(RootModel[list[LinearRing]]):
    root: list[LinearRing] = Field(..., min_length=1)


class MultiPolygon(BaseModel):
    type: Literal['MultiPolygon']
    coordinates: list[Coordinate] = Field(..., min_length=1)


class FieldGeometry(RootModel[Polygon | MultiPolygon]):
    root: Polygon | MultiPolygon = Field(
        ..., description='Field boundary. Area must be between 0.5 and 2,000 hectares.'
    )


class LatLon(BaseModel):
    lat: float
    lon: float


class Period(BaseModel):
    start: date_aliased
    end: date_aliased


class Quantity(BaseModel):
    """
    One number with its provenance. When `value` is null, `null_reason` is set and the evidence
    fields should be ignored. When `evidence_kind` is `model_output` and `value` is not null,
    `low` and `high` are set.

    """

    value: float | None
    unit: str = Field(
        ...,
        description='For example `mm`, `degC`, `t/ha/yr`, `days`, `months`, `bu/acre`, `USD/ha/yr`, `fraction`.',
    )
    low: float | None = Field(
        ..., description='10th percentile of the uncertainty runs.'
    )
    high: float | None = Field(
        ..., description='90th percentile of the uncertainty runs.'
    )
    evidence_kind: EvidenceKind | None
    access_tier: AccessTier | None
    dataset_ids: list[str] = Field(
        ..., description='Ids from `datasets[]` that this value depends on.'
    )
    native_resolution_m: float | None = Field(
        ..., description='Ground size of the coarsest dataset this value depends on.'
    )
    period: Period | None
    n_valid_obs: int | None = Field(
        ..., description='Valid observations used, for observed values.'
    )
    n_expected_obs: int | None = Field(
        ..., description='Observations the period should have had.'
    )
    null_reason: NullReason | None
    null_explanation: str | None = Field(
        ...,
        description='One plain sentence saying what is missing and why. Always set when `value` is null.',
    )
    retryable: bool = Field(
        ..., description='True only when `null_reason` is `fetch_failed`.'
    )
    needs_local_judgment: bool = Field(
        ...,
        description='True where a farmer or agronomist must confirm the value before relying on it.',
    )
    note: str | None = Field(
        None, description='Plain-language caveat specific to this value.'
    )


class Dataset(BaseModel):
    id: str = Field(
        ...,
        description='Stable id, for example `nasa_power`, `hls`, `smap_l4`, `grace_fo`, `ssurgo`, `usda_cdl`.',
    )
    name: str
    provider: str
    role: str = Field(..., description='What it is used for, in plain words.')
    coverage_scope: CoverageScope
    status: DatasetStatus
    null_reason: NullReason | None = Field(
        ..., description='Set when `status` is not `available`.'
    )
    retryable: bool
    message: str | None = Field(
        ..., description='Plain-language explanation when not available.'
    )
    access_tier: AccessTier | None
    evidence_kind: EvidenceKind
    native_resolution_m: float | None
    footprint: Polygon | None = Field(
        ...,
        description='The source cell or cells that cover the field, for datasets coarser than the field.\nNull for field-scale datasets. Draw it to show how much larger than the field the source is.\n',
    )
    period: Period | None
    as_of: AwareDatetime | None = Field(
        ..., description='Fetch time for `live`, snapshot creation time for `snapshot`.'
    )
    source_url: AnyUrl


class CoverageRequest(BaseModel):
    geometry: FieldGeometry


class RootingDepth(Enum):
    shallow = 'shallow'
    medium = 'medium'
    deep = 'deep'
    NoneType_None = None


class WaterDemand(Enum):
    low = 'low'
    medium = 'medium'
    high = 'high'
    NoneType_None = None


class Crop(BaseModel):
    id: str
    name: str
    category: CropCategory
    family: str | None = Field(
        ..., description='Botanical family, used for pest-cycle breaks.'
    )
    nitrogen_fixing: bool
    rooting_depth: RootingDepth | None
    water_demand: WaterDemand | None
    equipment: list[Equipment]
    suitable: bool | None = Field(
        ...,
        description='Climate screen at this location. Null where it cannot be judged.',
    )
    suitability_reason: str
    grown_locally: bool | None = Field(
        ...,
        description='True where regional records show the crop is grown nearby. Null where no record exists.',
    )


class CropList(BaseModel):
    location: LatLon
    crop_history_available: bool
    crops: list[Crop]


class RotationYear(BaseModel):
    crop_id: str = Field(
        ..., description='Id from `GET /v1/crops`. Use `fallow` for a fallow year.'
    )
    cover_crop_id: str | None = Field(
        None,
        description='Cover crop sown after harvest. An id of category `cover`, or null for none.',
    )


class RotationInput(BaseModel):
    years: list[RotationYear] = Field(
        ...,
        description='One entry per year of the cycle, in order.',
        max_length=8,
        min_length=1,
    )


class Equipment1(RootModel[list[Equipment]]):
    root: list[Equipment] = Field(
        ...,
        description='Equipment the farmer has. Null means unknown, in which case nothing is filtered and a gap is reported.',
    )


class Scenario(BaseModel):
    rainfall: RainfallScenario | None = 'normal'
    temperature: TemperatureScenario | None = 'normal'


class FieldInput(BaseModel):
    name: str | None = Field(None, max_length=80)
    geometry: FieldGeometry


class Grid(BaseModel):
    crs: str = Field(
        ...,
        description='Internal analysis CRS, for example `EPSG:5070`. Delivered geometry is always EPSG:4326.',
    )
    cell_size_m: float
    n_cells: int


class FieldSummary(BaseModel):
    name: str | None
    area_ha: float
    centroid: LatLon
    country_code: str | None = Field(..., description='ISO 3166-1 alpha-2.')
    coverage_scopes: list[CoverageScope] = Field(
        ..., description='Scopes that apply at this field. `global` is always present.'
    )
    grid: Grid


class ResolvedScenarioStep(BaseModel):
    id: str
    label: str
    definition: str = Field(
        ...,
        description='The rule in words, for example "A dry year that happens about one year in five here".',
    )
    quantity: Quantity | None = Field(
        ...,
        description='What the step means at this field, for example growing-season rainfall in mm.',
    )


class ResolvedScenario(BaseModel):
    rainfall: ResolvedScenarioStep
    temperature: ResolvedScenarioStep


class Weight(BaseModel):
    priority: Priority
    score_id: ScoreId
    rank: int | None = Field(
        ..., description="Position in the farmer's ranking, 1 first. Null if unranked."
    )
    weight: float = Field(..., ge=0.0, le=1.0)


class ScoreComponent(BaseModel):
    id: str
    label: str
    higher_is_better: bool
    quantity: Quantity


class Score(BaseModel):
    """
    `value` is 0 to 100 and higher is always better. Lead with `physical` in the interface where it
    exists. `composite` scores combine several components and have no single physical unit.

    """

    id: ScoreId
    label: str
    value: float | None = Field(..., ge=0.0, le=100.0)
    low: float | None
    high: float | None
    higher_is_better: Literal[True]
    composite: bool
    physical: Quantity | None = Field(
        ..., description='The underlying physical quantity, where one exists.'
    )
    physical_label: str | None = Field(
        ...,
        description='For example "Bare weeks per year" or "Seasonal water shortfall".',
    )
    physical_higher_is_better: bool | None
    components: list[ScoreComponent]
    weight: float = Field(
        ..., description="Weight from the farmer's ranking used in `overall`."
    )
    explanation: str
    null_reason: NullReason | None
    null_explanation: str | None = Field(
        ...,
        description='One plain sentence saying what is missing and why. Always set when `value` is null.',
    )
    retryable: bool


class CoverCell(BaseModel):
    cycle_year: int = Field(..., ge=1)
    month: int = Field(..., ge=1, le=12)
    state: CoverState
    crop_id: str | None
    covered_fraction: float = Field(
        ...,
        description='Share of the month with the ground covered. Below 1 where planting or harvest falls mid-month.',
        ge=0.0,
        le=1.0,
    )


class CoverCalendar(BaseModel):
    """
    Twelve cells per cycle year. For the current rotation the bare months can be satellite
    observations. For every alternative the calendar is model output from typical planting and
    harvest dates.

    """

    evidence_kind: EvidenceKind
    access_tier: AccessTier
    dataset_ids: list[str]
    period: Period | None
    n_valid_obs: int | None
    n_expected_obs: int | None
    cells: list[CoverCell]
    bare_weeks_per_year: Quantity = Field(
        ...,
        description='Weeks of bare soil per year, averaged over the cycle. Computed from daily cover state, so\nit is finer than the monthly cells. Its range reflects planting and harvest date spread.\n',
    )
    living_cover_weeks_per_year: Quantity = Field(
        ...,
        description='Weeks per year with a crop or cover crop growing, averaged over the cycle.',
    )


class RiskCell(BaseModel):
    cycle_year: int = Field(..., ge=1)
    month: int = Field(..., ge=1, le=12)
    hazard: CalendarHazard
    level: RiskLevel | None
    share_of_years: float | None = Field(
        ...,
        description='Share of years in the record in which the hazard occurred in this month while the crop was exposed.',
        ge=0.0,
        le=1.0,
    )
    exposed_crop_id: str | None


class RiskCalendar(BaseModel):
    evidence_kind: EvidenceKind
    access_tier: AccessTier
    dataset_ids: list[str]
    native_resolution_m: float | None
    period: Period | None
    n_years: int | None
    cells: list[RiskCell]
    null_reason: NullReason | None
    null_explanation: str | None = Field(
        ...,
        description='One plain sentence saying what is missing and why. Always set when `null_reason` is set.',
    )


class Kind(StrEnum):
    vegetation_stress_window = 'vegetation_stress_window'
    bare_field_window = 'bare_field_window'
    soil_moisture_anomaly = 'soil_moisture_anomaly'
    evapotranspiration = 'evapotranspiration'
    water_balance = 'water_balance'
    rainfall_reliability = 'rainfall_reliability'
    extreme_rain = 'extreme_rain'
    frost_risk = 'frost_risk'
    heat_stress = 'heat_stress'
    slope_erosion = 'slope_erosion'
    soil_property = 'soil_property'
    water_storage_trend = 'water_storage_trend'
    groundwater_trend = 'groundwater_trend'
    market_presence = 'market_presence'
    yield_history = 'yield_history'
    price_history = 'price_history'


class EvidenceItem(BaseModel):
    id: str
    kind: Kind
    title: str
    summary: str = Field(
        ..., description='Plain language, no index names without explanation.'
    )
    quantity: Quantity
    series_id: str | None = Field(
        ..., description='Id in `Analysis.series` when a time series backs this item.'
    )


class Signal(StrEnum):
    soil = 'soil'
    climate = 'climate'
    water = 'water'
    bare_field = 'bare_field'
    crop_stress = 'crop_stress'
    terrain = 'terrain'
    market = 'market'
    farmer_priority = 'farmer_priority'


class Reason(BaseModel):
    signal: Signal
    text: str
    evidence_ids: list[str]


class Tag(StrEnum):
    water_saving = 'water_saving'
    nitrogen_fixation = 'nitrogen_fixation'
    deep_rooting = 'deep_rooting'
    organic_matter = 'organic_matter'
    soil_cover = 'soil_cover'
    infiltration = 'infiltration'
    erosion_control = 'erosion_control'
    pest_cycle_break = 'pest_cycle_break'
    forage = 'forage'
    income = 'income'


class Benefit(BaseModel):
    tag: Tag
    text: str
    quantity: Quantity | None


class Direction(StrEnum):
    """
    Decided by the server on paired uncertainty runs, where both rotations face the same
    weather year, soil and crop draws. `better` or `worse`: this rotation wins or loses in
    nearly all runs. `uncertain`: the values differ but neither wins consistently, shown as
    "Too close to call". `similar`: no meaningful difference. `unknown`: one side is null.
    The thresholds are in `Meta.tradeoff_rule`.

    """

    better = 'better'
    worse = 'worse'
    similar = 'similar'
    uncertain = 'uncertain'
    unknown = 'unknown'


class Tradeoff(BaseModel):
    """
    One dimension of this rotation compared with the current rotation.
    """

    score_id: ScoreId
    direction: Direction = Field(
        ...,
        description='Decided by the server on paired uncertainty runs, where both rotations face the same\nweather year, soil and crop draws. `better` or `worse`: this rotation wins or loses in\nnearly all runs. `uncertain`: the values differ but neither wins consistently, shown as\n"Too close to call". `similar`: no meaningful difference. `unknown`: one side is null.\nThe thresholds are in `Meta.tradeoff_rule`.\n',
    )
    share_of_runs_better: float | None = Field(
        ...,
        description='Share of paired runs in which this rotation scored higher than the current one.',
        ge=0.0,
        le=1.0,
    )
    score_delta: float | None = Field(
        ..., description="This rotation's score minus the current rotation's."
    )
    physical_delta: Quantity | None = Field(
        ...,
        description='Difference in the physical quantity, signed, where both sides have one.',
    )
    text: str


class Gap(BaseModel):
    id: str
    text: str
    affects: list[ScoreId]
    dataset_id: str | None
    null_reason: NullReason | None


class Reviewer(StrEnum):
    farmer = 'farmer'
    agronomist = 'agronomist'
    extension_service = 'extension_service'
    water_authority = 'water_authority'
    buyer = 'buyer'


class LocalReview(BaseModel):
    topic: str
    text: str
    reviewer: Reviewer


class RankStability(BaseModel):
    share_ranked_first: float | None = Field(
        ...,
        description='Share of uncertainty runs in which this rotation had the highest overall score.',
        ge=0.0,
        le=1.0,
    )
    n_runs: int


class Overall(BaseModel):
    null_explanation: str | None = Field(
        ...,
        description="Why there is no overall score. The rotations are not ranked when the farmer's first\npriority could not be scored for every one of them.\n",
    )
    value: float | None = Field(
        ...,
        description="Weighted mean of the non-null scores under the farmer's ranking.",
    )
    low: float | None
    high: float | None
    rank: int | None = Field(..., ge=1)
    rank_stability: RankStability


class RotationYearResolved(BaseModel):
    cycle_year: int = Field(..., ge=1)
    crop_id: str
    crop_name: str
    cover_crop_id: str | None


class ObservedYear(BaseModel):
    """
    What the crop map shows on the field in one year.
    """

    year: int
    crop_id: str | None = Field(
        ...,
        description='Null when no class covered half the field, or the class is not a crop this tool handles.',
    )
    class_name: str = Field(
        ..., description="The crop map's own name for the largest class that year."
    )
    share_of_field: float = Field(..., ge=0.0, le=1.0)
    n_cells: int = Field(..., description='Grid cells or sample points read that year.')


class DetectedRotation(BaseModel):
    years: list[RotationYear] = Field(
        ...,
        description='Can be sent back unchanged as `farmer.current_rotation.years`.',
        min_length=1,
    )
    label: str
    detection_basis: DetectionBasis
    share_of_years_consistent: Quantity


class CropHistory(BaseModel):
    field: FieldSummary
    crop_history_available: bool
    detected: DetectedRotation | None = Field(
        ...,
        description='Null when no rotation could be read. `null_reason` then says why.',
    )
    observed_years: list[ObservedYear]
    null_reason: NullReason | None
    null_explanation: str | None
    retryable: bool


class CropFitCheck(BaseModel):
    check: CropFitCheckId
    status: CropFitStatus
    quantity: Quantity
    text: str = Field(
        ..., description='One plain sentence with the figure that decided the status.'
    )


class CropFailureCauses(BaseModel):
    """
    Failed years by cause. They sum to `years_failed`.
    """

    frost: int | None = Field(
        ...,
        description='Null when the crop has no growth stages to judge frost by, as for a perennial.',
        ge=0,
    )
    heat: int | None = Field(
        ...,
        description='Null when the crop has no flowering stage to judge heat by, as for a perennial.',
        ge=0,
    )
    water: int | None = Field(
        ...,
        description="Null when the field's soil values or the crop's yield response factor are missing.",
        ge=0,
    )


class BaselineSource(StrEnum):
    cdl_derived = 'cdl_derived'
    farmer_supplied = 'farmer_supplied'


class BaselineDetection(BaseModel):
    """
    Present on the current rotation only.
    """

    detection_basis: DetectionBasis | None = Field(
        ..., description='Null when the farmer supplied the rotation.'
    )
    observed_years: list[ObservedYear] = Field(
        ...,
        description="The crop map's year-by-year reading. Empty when the farmer supplied the rotation.",
    )
    baseline_source: BaselineSource
    farmer_confirmed: bool
    share_of_years_consistent: Quantity | None = Field(
        ...,
        description='Share of observed years that match the detected cycle. Null when farmer supplied.',
    )


class Role(StrEnum):
    current = 'current'
    alternative = 'alternative'


class ChangeLevel(StrEnum):
    """
    How far this rotation departs from the current one.
    """

    none = 'none'
    low = 'low'
    high = 'high'


class SeriesPoint(BaseModel):
    t: date_aliased = Field(..., description='Start of the period.')
    value: float | None
    n_valid_obs: int | None
    n_expected_obs: int | None


class Cadence(StrEnum):
    daily = 'daily'
    sixteen_day = 'sixteen_day'
    monthly = 'monthly'
    yearly = 'yearly'


class Series(BaseModel):
    id: str
    label: str
    unit: str
    cadence: Cadence
    evidence_kind: EvidenceKind
    access_tier: AccessTier
    dataset_ids: list[str]
    native_resolution_m: float | None
    points: list[SeriesPoint]


class ComparisonBasis(StrEnum):
    same_unit_value = 'same_unit_value'
    trend_direction = 'trend_direction'
    none = 'none'


class Agreement(StrEnum):
    consistent = 'consistent'
    differs = 'differs'
    not_comparable = 'not_comparable'


class SatelliteGroundPair(BaseModel):
    """
    A satellite or model value beside a ground measurement of the same thing. The two are never
    merged. `difference` is present only when `comparison_basis` is `same_unit_value`.

    """

    id: str
    label: str
    satellite: Quantity
    ground: Quantity
    comparison_basis: ComparisonBasis
    agreement: Agreement
    difference: Quantity | None
    rule: str = Field(..., description='The test that decided `agreement`, in words.')
    ground_site_count: int | None
    ground_distance_km: float | None = Field(
        ..., description='Distance from the field to the nearest ground site used.'
    )


class Id(StrEnum):
    weather_variability = 'weather_variability'
    soil_properties = 'soil_properties'
    crop_parameters = 'crop_parameters'
    rainfall_source_disagreement = 'rainfall_source_disagreement'


class UncertaintyDriver(BaseModel):
    id: Id
    label: str
    share: float | None = Field(
        ...,
        description='Share of the spread in the overall score attributable to this source.',
        ge=0.0,
        le=1.0,
    )


class Uncertainty(BaseModel):
    method: str
    n_runs: int
    interval: Literal['p10_p90']
    seed: str
    drivers: list[UncertaintyDriver]


class ZoneSummary(BaseModel):
    hazard: ZoneHazard
    available: bool
    field_wide: bool = Field(
        ...,
        description='True when the source cannot separate parts of the field, so the whole field is one class.',
    )
    null_reason: NullReason | None


class OwnFigures(BaseModel):
    crop_id: str = Field(
        ...,
        description='A single crop from `GET /v1/crops`, not a two-crops-a-year pair.',
    )
    yield_t_per_ha: float = Field(..., gt=0.0, le=100.0)
    price_per_tonne: float = Field(..., gt=0.0)


class CloseCall(BaseModel):
    rotation_ids: list[str] = Field(
        ...,
        description='The first-ranked rotation, then every rotation it is not clearly ahead of, in rank order. Can include what is grown now.',
        min_length=2,
    )
    share_of_runs_first_ahead: float = Field(
        ...,
        description='Share of paired runs in which the first-ranked rotation scored higher than the closest of the others.',
        ge=0.0,
        le=1.0,
    )
    text: str


class Currency(BaseModel):
    """
    The currency every money figure in the result is in.
    """

    code: str = Field(
        ..., description='ISO 4217 code, for example `USD`, `PHP`, `THB`.'
    )
    name: str


class ReasoningStepId(StrEnum):
    field = 'field'
    conditions = 'conditions'
    crop_fit = 'crop_fit'
    runs = 'runs'
    scores = 'scores'
    weights = 'weights'
    ranking = 'ranking'


class ReasoningFact(BaseModel):
    """
    One value read from the analysis result, with the field it was read from.
    """

    group: str | None = Field(
        ...,
        description='The rotation, crop or set the fact belongs to. Null when the step has a single set.',
    )
    label: str
    text: str = Field(
        ...,
        description='The value in words, rounded as shown. It can add the unit, range or sentence that sits\nbeside the value in the same item of the result.\n',
    )
    value: float | None = Field(
        ...,
        description='The number at `source`, unrounded. Null when the fact is words or a period.',
    )
    source: str = Field(
        ...,
        description='Where in the analysis result the fact was read, for example\n`field_evidence[id=rainfall].quantity.value`. `[key=value]` picks the list item whose `key` is `value`.\n',
    )
    dataset_ids: list[str] = Field(
        ...,
        description="Ids from `datasets[]` behind the fact. Empty for the farmer's answers and the engine's own results.",
    )


class ReasoningStep(BaseModel):
    id: ReasoningStepId
    title: str
    method: str = Field(
        ..., description='What the engine does in this step, in plain words.'
    )
    facts: list[ReasoningFact]


class SummaryStatus(StrEnum):
    """
    `not_configured`: no language model is set up; the engine wrote the summary.
    `accepted`: the model's reply passed every check and is the summary.
    `rejected`: the reply failed a check; the engine's summary is shown and `status_note` says why.
    `failed`: the model did not answer in time or its answer could not be read; the engine's summary is shown.

    """

    not_configured = 'not_configured'
    accepted = 'accepted'
    rejected = 'rejected'
    failed = 'failed'


class ReasoningSummary(BaseModel):
    text: str = Field(
        ...,
        description='Written by the model when `status` is `accepted`, by the engine otherwise.',
    )
    status: SummaryStatus
    model: str | None = Field(
        ...,
        description='The language model asked, for example `openai/gpt-4o-mini`. Null when none is set up.',
    )
    status_note: str | None = Field(
        ...,
        description="Why the model's reply is not shown, in one plain sentence. Null unless `status` is `rejected` or `failed`.",
    )
    facts_given: list[str] = Field(
        ...,
        description='The exact lines the model was given, one fact each. Empty when no model is set up.',
    )


class Reasoning(BaseModel):
    analysis_id: str
    steps: list[ReasoningStep] = Field(..., min_length=1)
    summary: ReasoningSummary


class ZoneClass(BaseModel):
    index: RiskLevel
    label: str
    min: float | None
    max: float | None


class Properties(BaseModel):
    class_index: RiskLevel
    value: float | None = Field(
        ..., description='Mean raw value in the zone, in the legend unit.'
    )
    area_ha: float


class ZoneFeature(BaseModel):
    type: Literal['Feature']
    geometry: Polygon | MultiPolygon
    properties: Properties


class ZoneFeatureCollection(BaseModel):
    type: Literal['FeatureCollection']
    features: list[ZoneFeature]


class ZoneLayer(BaseModel):
    hazard: ZoneHazard
    label: str
    field_wide: bool
    evidence_kind: EvidenceKind | None
    access_tier: AccessTier | None
    dataset_ids: list[str]
    native_resolution_m: float | None
    period: Period | None
    n_valid_obs: int | None
    n_expected_obs: int | None
    unit: str | None
    classes: list[ZoneClass] = Field(..., description='Class breaks for the legend.')
    null_reason: NullReason | None
    null_explanation: str | None = Field(
        ...,
        description='One plain sentence saying what is missing and why. Always set when `features` is null.',
    )
    retryable: bool
    needs_local_judgment: bool
    features: ZoneFeatureCollection | None


class ZoneLayers(BaseModel):
    analysis_id: str
    grid: Grid
    layers: list[ZoneLayer] = Field(
        ..., description='One per hazard, always all four.', max_length=4, min_length=4
    )


class Step(StrEnum):
    day = 'day'
    month = 'month'


class Time(BaseModel):
    default: date_aliased
    start: date_aliased
    end: date_aliased
    step: Step


class ContextLayer(BaseModel):
    id: str
    title: str
    kind: LayerKind
    dataset_id: str = Field(
        ...,
        description="The product shown. A label, not a key into an analysis's `datasets[]`.",
    )
    url_template: str = Field(
        ...,
        description='Web Mercator tile template with `{z}`, `{x}`, `{y}` and, when `time` is set, `{time}`. A\nlayer rendered on request uses `{bbox-epsg-3857}` in place of the three tile tokens.\n',
    )
    license: str | None = Field(
        ...,
        description='For example "Public domain" or "CC BY-NC-SA 4.0". Null where the publisher states none.',
    )
    license_url: AnyUrl | None
    detail_of: str | None = Field(
        ...,
        description='Id of the layer this one sharpens at close zoom. Draw it over that layer from `min_zoom` up.',
    )
    tile_size: int
    min_zoom: int
    max_zoom: int
    attribution: str
    coverage_scope: CoverageScope
    native_resolution_m: float | None
    pre_rendered: Literal[True]
    time: Time | None
    legend_url: AnyUrl | None


class LayerList(BaseModel):
    location: LatLon
    layers: list[ContextLayer]


class OutlookDay(BaseModel):
    rain_chance: float | None = Field(
        ..., description='Chance of rain that day, 0 to 1.', ge=0.0, le=1.0
    )
    date: date_aliased
    t_max_c: float
    t_min_c: float
    rain_mm: float = Field(..., ge=0.0)
    frost: bool = Field(
        ...,
        description='The forecast minimum is at or below the frost threshold served by meta.',
    )
    heat: bool = Field(
        ...,
        description='The forecast maximum is at or above the heat threshold served by meta.',
    )


class Outlook(BaseModel):
    location: LatLon
    available: bool
    dataset_id: str
    provider: str
    source_url: AnyUrl
    evidence_kind: EvidenceKind
    access_tier: AccessTier
    issued_at: AwareDatetime | None = Field(
        ..., description='When the forecast was fetched.'
    )
    days: list[OutlookDay] = Field(..., max_length=10)
    null_reason: NullReason | None
    null_explanation: str | None
    retryable: bool
    note: str


class BriefingRecentRain(BaseModel):
    """
    Rain that has fallen lately, from the daily weather record. The record runs a few days behind.
    """

    available: bool
    null_reason: NullReason | None
    null_explanation: str | None
    dataset_ids: list[str]
    last_7_days_mm: float | None
    last_30_days_mm: float | None
    last_real_rain_date: date_aliased | None
    read_through: date_aliased | None


class BriefingSoilWetness(BaseModel):
    """
    How wet the soil is on a scale from 0, completely dry, to 1, saturated. It is not a share of the soil's volume. One value for a weather cell about 55 km wide.
    """

    available: bool
    null_reason: NullReason | None
    null_explanation: str | None
    dataset_ids: list[str]
    now: float | None
    usual: float | None
    usual_low: float | None
    usual_high: float | None
    read_on: date_aliased | None


class BriefingWeekWater(BaseModel):
    """
    Water a well-watered crop cover would lose over the next seven days, from the forecast.
    """

    available: bool
    null_reason: NullReason | None
    null_explanation: str | None
    dataset_ids: list[str]
    loss_mm: float | None
    basis: str | None


class BriefingMonthOutlook(BaseModel):
    """
    What next month usually brings, from the long record. Not a seasonal forecast.
    """

    available: bool
    null_reason: NullReason | None
    null_explanation: str | None
    dataset_ids: list[str]
    month: int | None = Field(..., ge=1, le=12)
    rain_mm: float | None
    rain_basis: str | None
    coldest_night_c: float | None
    coldest_night_basis: str | None
    frost_share_of_years: float | None
    frost_basis: str | None
    usual_pattern: bool


class BriefingYearClimate(BaseModel):
    """
    The long weather record in a few numbers.
    """

    available: bool
    null_reason: NullReason | None
    null_explanation: str | None
    dataset_ids: list[str]
    usual_rain_mm: float | None
    dry_year_mm: float | None
    interval: str | None
    monthly_rain_mm: list[float] | None = Field(..., max_length=12, min_length=12)
    hot_days_per_year: float | None
    frost_days_per_year: float | None
    hottest_day_c: float | None
    coldest_night_c: float | None
    record_years: str | None


class Crop1(BaseModel):
    crop_id: str
    name: str
    verdict: str
    good: bool
    reason: str


class BriefingCropAdvice(BaseModel):
    """
    Which crops are in their sowing window, checked against the forecast, topsoil wetness and what
    next month usually brings. In the United States the window is the weeks in which the middle 80%
    of the state's crop was planted, from USDA crop progress reports. Elsewhere it is a general
    reference date. The weather rules are simple conventions, so this is always for local judgment.

    """

    basis: str | None = Field(
        ..., description='Where the planting dates come from, in words for the farmer.'
    )
    needs_local_judgment: bool
    available: bool
    null_reason: NullReason | None
    null_explanation: str | None
    dataset_ids: list[str]
    crops: list[Crop1]
    action: str | None


class Briefing(BaseModel):
    location: LatLon
    as_of: date_aliased
    forecast: Outlook
    recent_rain: BriefingRecentRain
    soil_surface: BriefingSoilWetness
    soil_root_zone: BriefingSoilWetness
    week_water: BriefingWeekWater
    month_outlook: BriefingMonthOutlook
    year_climate: BriefingYearClimate
    sow_this_week: BriefingCropAdvice
    plant_this_month: BriefingCropAdvice


class Label(BaseModel):
    id: str
    label: str
    description: str


class ScoreDefinition(BaseModel):
    id: ScoreId
    label: str
    description: str
    composite: bool
    physical_label: str | None
    physical_unit: str | None
    physical_higher_is_better: bool | None
    priority: Priority


class Interval(BaseModel):
    id: Literal['p10_p90']
    description: str


class TradeoffRule(BaseModel):
    """
    The thresholds that decide `Tradeoff.direction`.
    """

    better_share_min: float = Field(
        ...,
        description='At or above this share of paired runs won, the direction is `better`.',
    )
    worse_share_max: float = Field(
        ..., description='At or below this share, the direction is `worse`.'
    )
    similar_score_delta_max: float = Field(
        ...,
        description='Below this absolute median score difference, the direction is `similar`.',
    )
    description: str = Field(..., description='The rule in plain words.')


class Meta(BaseModel):
    """
    Display labels are locked with the design system and served only from here:
    - evidence kinds: Satellite, Ground reading, Soil survey baseline, Model output
    - null reasons: No coverage, Not set up, Too few readings, Could not load
    - needs_local_judgment: Check locally
    - risk levels 0, 1, 2: Lower, Raised, High
    - cover states: Crop, Cover crop, Stubble, Bare
    - calendar hazards: Frost while a crop is vulnerable, Heat while a crop is vulnerable,
      Dry spell while a crop is growing, Heavy rain, Bare soil
    - rainfall scenarios: Normal, Dry, Very dry. Temperature scenarios: Normal, Warm, Hot
    - tradeoff direction `uncertain`: Too close to call

    """

    contract_version: str
    disclaimer: str
    interval: Interval
    evidence_kinds: list[Label] = Field(
        ..., description='Exactly four.', max_length=4, min_length=4
    )
    access_tiers: list[Label]
    null_reasons: list[Label] = Field(
        ..., description='The label for `out_of_coverage` is "No coverage".'
    )
    needs_local_judgment: Label
    scores: list[ScoreDefinition]
    priorities: list[Label]
    zone_hazards: list[Label]
    calendar_hazards: list[Label]
    risk_levels: list[Label]
    rainfall_scenarios: list[Label]
    temperature_scenarios: list[Label]
    cover_states: list[Label]
    job_stages: list[Label]
    equipment: list[Label]
    tradeoff_directions: list[Label]
    crop_fit_statuses: list[Label]
    crop_fit_checks: list[Label] = Field(
        ...,
        description='Each description states the rule that decides the status, with its thresholds.',
    )
    layer_kinds: list[Label]
    detection_bases: list[Label]
    tradeoff_rule: TradeoffRule = Field(
        ..., description='The thresholds that decide `Tradeoff.direction`.'
    )


class Health(BaseModel):
    status: Literal['ok']
    contract_version: str


class ProblemField(BaseModel):
    field: str = Field(..., description='JSON pointer into the request body.')
    message: str


class Problem(BaseModel):
    type: str = Field(
        ...,
        description='Stable error identifier, for example `field_too_large`, `rotation_required`, `unknown_crop`, `not_found`, `not_finished`, `insufficient_candidates`, `internal`.',
    )
    title: str
    status: int
    detail: str
    errors: list[ProblemField] | None = None


class Coverage(BaseModel):
    field: FieldSummary
    datasets: list[Dataset]
    crop_history_available: bool = Field(
        ..., description='False means `farmer.current_rotation` is required.'
    )


class FarmerInputs(BaseModel):
    water_availability: WaterAvailability
    irrigation_allowance_mm: float | None = Field(
        None,
        description='Irrigation water available per year, if the farmer knows it.',
        ge=0.0,
    )
    equipment: Equipment1 | None = Field(
        None,
        description='Equipment the farmer has. Null means unknown, in which case nothing is filtered and a gap is reported.',
    )
    priorities: list[Priority] = Field(
        ...,
        description='Ranked, most important first. Unranked priorities get zero weight in the overall ranking and are still reported.',
        max_length=6,
        min_length=1,
    )
    require_forage: bool | None = Field(
        False, description='Alternatives must include a forage crop.'
    )
    local_market_only: bool | None = Field(
        False, description='Only suggest crops with evidence of being grown locally.'
    )
    excluded_crop_ids: list[str] | None = None
    preferred_crop_ids: list[str] | None = None
    own_figures: list[OwnFigures] | None = Field(
        [],
        description="The farmer's own yield and selling price for a crop. Where given, they replace any published\nrecord for that crop when income is worked out. The price is in the currency the result reports\nin `currency`: US dollars in the United States, the country's own currency elsewhere.\n",
        validate_default=True,
    )
    current_rotation: RotationInput | None = Field(
        None,
        description='Overrides the detected rotation. Required where no crop-history layer exists.',
    )
    current_rotation_confirmed: bool | None = Field(
        False,
        description='True once the farmer has confirmed the rotation proposed by `POST /v1/crop-history`. It\nchanges no number; it only sets `baseline.farmer_confirmed`. A supplied `current_rotation`\nalways counts as confirmed.\n',
    )


class AnalysisRequest(BaseModel):
    field: FieldInput
    farmer: FarmerInputs
    scenario: Scenario | None = None


class CropFailure(BaseModel):
    """
    The recurrence rate of potential crop failure, after CropSuite v1.0 (Zabel, Knüttel and Poschlod 2025, Geosci. Model
    Dev. 18, 1067-1087), counted over weather years of the record, not over runs. A season fails on a killing frost while
    the crop emerges or sets grain, a sustained spell of extreme heat while it flowers, or a water shortage, given the
    supply the farmer stated, that costs more than half its yield (FAO-33: 1 - Ya/Ym = Ky (1 - ETa/ETc)). A weather year
    counts as a likely failure when at least half of the runs fail a season of the crop harvested in it; the runs differ
    in soil, planting date and crop within their stated ranges. Each failed year is counted once, under the cause that
    failed the most runs of its worst season. The thresholds are in `backend/app/core/config.py`.

    """

    years_failed: int = Field(..., ge=0)
    years_total: int = Field(
        ...,
        description='The weather years the crop is harvested in across the runs: every year of the record under normal rainfall,\nonly the driest years under a dry rainfall scenario.\n',
        ge=1,
    )
    by_cause: CropFailureCauses


class CropFit(BaseModel):
    """
    How the field's conditions suit one crop of the rotation. The rules are in `Meta.crop_fit_checks`.
    """

    crop_id: str
    crop_name: str
    checks: list[CropFitCheck] = Field(
        ...,
        description='Always the four checks, in `CropFitCheckId` order.',
        max_length=4,
        min_length=4,
    )
    limiting_check: CropFitCheckId | None = Field(
        ...,
        description="The check that constrains this crop most here, after Liebig's law of the minimum as CropSuite v1.0 uses it\n(Zabel, Knüttel and Poschlod 2025, Geosci. Model Dev. 18, 1067-1087): the worst status, ties broken by how far\nthe check's figure is past the threshold of that status, as a share of the threshold. Null when every check fits\nor cannot be judged.\n",
    )
    failure: CropFailure | None = Field(
        ...,
        description='How often this crop would likely fail at this field. Null when no cause of failure can be judged for it.',
    )


class Rotation(BaseModel):
    crops_per_year: float = Field(
        ...,
        description='Crops grown per year, averaged over the cycle. A fallow year counts as none.',
        ge=0.0,
    )
    id: str
    role: Role
    change_level: ChangeLevel = Field(
        ..., description='How far this rotation departs from the current one.'
    )
    label: str = Field(..., description='For example "Corn, then wheat, then sorghum".')
    years: list[RotationYearResolved] = Field(..., min_length=1)
    baseline: BaselineDetection | None
    crop_fit: list[CropFit] = Field(
        ..., description='One entry per crop in the rotation, in the order grown.'
    )
    cover_calendar: CoverCalendar
    scores: list[Score] = Field(
        ...,
        description='Always all six, in `ScoreId` order.',
        max_length=6,
        min_length=6,
    )
    overall: Overall
    why_suggested: list[Reason]
    evidence: list[EvidenceItem]
    benefits: list[Benefit]
    tradeoffs: list[Tradeoff] = Field(
        ..., description='Empty for the current rotation.'
    )
    risk_calendar: RiskCalendar
    gaps: list[Gap]
    local_review: list[LocalReview]


class Analysis(BaseModel):
    currency: Currency
    close_call: CloseCall | None = Field(
        ...,
        description='Set when the first-ranked rotation is not clearly ahead of another: it scored higher in fewer\nthan three of four paired runs, or the two are under two points apart. Say so with the ranking\ninstead of naming one winner. Null when the first-ranked rotation is clearly ahead of every other.\n',
    )
    ranking_note: str | None = Field(
        ...,
        description='Set when something the farmer ranked could not be scored, so the ranking leaves it out.\nShow it with the ranking, not in a drawer. Null when everything ranked was scored.\n',
    )
    contract_version: str
    analysis_id: str
    created_at: AwareDatetime
    disclaimer: str = Field(
        ...,
        description='The statement that the tool supports and does not replace local expertise.',
    )
    request: AnalysisRequest
    field: FieldSummary
    datasets: list[Dataset]
    scenario: ResolvedScenario
    weights: list[Weight]
    rotations: list[Rotation] = Field(
        ...,
        description='The current rotation first, then alternatives by overall rank.',
        min_length=3,
    )
    field_evidence: list[EvidenceItem] = Field(
        ..., description='Conditions of the field that hold whatever is grown.'
    )
    series: list[Series]
    comparisons: list[SatelliteGroundPair]
    zones: list[ZoneSummary] = Field(
        ...,
        description='Which zone layers exist. Geometry is at `GET /v1/analyses/{analysis_id}/zones`.',
    )
    uncertainty: Uncertainty
    gaps: list[Gap] = Field(..., description='Gaps that apply to the whole analysis.')


class Job(BaseModel):
    analysis_id: str
    status: JobStatus
    stage: str | None = Field(
        ...,
        description='Machine id of the current stage. Ids and labels are listed in `Meta.job_stages`.',
    )
    stage_label: str | None = Field(
        ...,
        description='Human-readable stage, for example "Fetching rainfall history".',
    )
    created_at: AwareDatetime
    updated_at: AwareDatetime
    error: Problem | None = Field(..., description='Set when `status` is `error`.')
    result: Analysis | None = Field(..., description='Set when `status` is `done`.')
