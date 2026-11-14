// What the home screen needs for one field, in one typed shape.
//
// `GET /v1/briefing?lat&lon` serves weather, rain, soil wetness, next-month normals, the year
// pattern, and FAO-56 sowing/planting window advice (`sow_this_week`, `plant_this_month`) when a
// regional crop calendar and weather signals are available. When either is missing, those parts
// arrive marked unavailable and this adapter keeps that gap honest without inventing crops or dates.

import type {
  Analysis,
  Briefing,
  BriefingCropAdvice,
  BriefingSoilWetness,
  EvidenceItem,
  Outlook,
} from './types';

export type Reading<T> = ({ available: true } & T) | { available: false; why: string };

const missing = (why: string): { available: false; why: string } => ({ available: false, why });

const DATASET_NAMES: Record<string, string> = {
  nasa_power: 'NASA POWER',
  meteomatics: 'Meteomatics AG',
  smap_l4: 'NASA SMAP',
  chirps: 'CHIRPS',
  hls: 'Harmonized Landsat and Sentinel-2',
  openet: 'OpenET',
  ecostress: 'NASA ECOSTRESS',
  soilgrids: 'SoilGrids',
};

export interface ForecastDay {
  /** Local day at the field, as an ISO date. */
  date: string;
  highC: number;
  lowC: number;
  rainMm: number;
  /** Chance of rain, 0 to 1, or null when the source gives amounts only. */
  rainChance: number | null;
  frost: boolean;
  heat: boolean;
}

export interface Forecast {
  days: ForecastDay[];
  provider: string;
  issuedAt: string | null;
}

export interface RecentRain {
  last7DaysMm: number;
  last30DaysMm: number;
  /** The last day with 1 mm or more, as an ISO date. */
  lastRealRain: string | null;
  readThrough: string | null;
  source: string;
}

export interface SoilMoisture {
  /** Soil wetness from 0 (completely dry) to 1 (saturated). */
  now: number;
  /** The mean of earlier readings for the same calendar month. */
  usual: number | null;
  /** The range most earlier readings for this month fell in. */
  usualLow: number | null;
  usualHigh: number | null;
  /** The date of the latest reading. */
  readOn: string;
  source: string;
  /** True when 0..1 is a wetness index rather than share of soil volume. */
  wetnessScale: boolean;
}

export interface WeekWater {
  /** Water a well-watered crop cover would lose over the next seven days. */
  lossMm: number;
  basis: string | null;
  source: string;
}

export interface MonthOutlook {
  month: number;
  rainMm: { value: number; basis: string | null };
  coldestNightC: { value: number; basis: string | null };
  frost: { shareOfYears: number | null; words: string; basis: string | null };
  /** True when this is the long-record pattern rather than a seasonal forecast. */
  usualPattern: boolean;
  recordYears: string | null;
  source: string;
}

export interface YearClimate {
  usualRainMm: number;
  /** The low end of yearly rain in the record. */
  dryYearMm: number | null;
  /** How the range is drawn, for example "p10_p90". */
  interval: string | null;
  hotDaysPerYear: number | null;
  /** What counts as a hot day, in the backend's words. */
  hotDayWords: string | null;
  frostDaysPerYear: number | null;
  hottestDayC: number | null;
  coldestNightC: number | null;
  recordYears: string | null;
  /** Usual rain for each month, January first. */
  monthlyRainMm: number[] | null;
  source: string | null;
}

export interface CropAdvice {
  crops: { crop_id?: string; name: string; verdict: string; good: boolean; reason: string }[];
  action: string | null;
  basis?: string | null;
}

export interface FieldBriefing {
  forecast: Reading<Forecast>;
  recentRain: Reading<RecentRain>;
  soilSurface: Reading<SoilMoisture>;
  soilRootZone: Reading<SoilMoisture>;
  weekWater: Reading<WeekWater>;
  monthOutlook: Reading<MonthOutlook>;
  yearClimate: Reading<YearClimate>;
  sowThisWeek: Reading<CropAdvice>;
  plantThisMonth: Reading<CropAdvice>;
}

export type BriefingState =
  | { status: 'loading' }
  | { status: 'ready'; briefing: Briefing }
  | { status: 'failed'; detail: string };

const sourceName = (datasetIds: string[], analysis: Analysis | null, fallback = 'the weather record') => {
  const fromAnalysis = analysis?.datasets.find((dataset) => datasetIds.includes(dataset.id))?.name;
  if (fromAnalysis) return fromAnalysis;
  for (const id of datasetIds) {
    if (id in DATASET_NAMES) return DATASET_NAMES[id];
  }
  return fallback;
};

const evidenceOf = (analysis: Analysis, kind: EvidenceItem['kind']) =>
  analysis.field_evidence.find((item) => item.kind === kind);

function forecastFromOutlook(outlook: Outlook): Reading<Forecast> {
  if (!outlook.available || outlook.days.length === 0) {
    return missing(
      outlook.null_explanation ?? 'The forecast service is not connected, so there is no forecast for this field.',
    );
  }
  return {
    available: true,
    provider: outlook.provider,
    issuedAt: outlook.issued_at,
    days: outlook.days.map((day) => ({
      date: day.date,
      highC: day.t_max_c,
      lowC: day.t_min_c,
      rainMm: day.rain_mm,
      rainChance: day.rain_chance ?? null,
      frost: day.frost,
      heat: day.heat,
    })),
  };
}

function recentRainFrom(state: BriefingState, analysis: Analysis | null): Reading<RecentRain> {
  if (state.status === 'loading') return missing('We are fetching recent rain for your field.');
  if (state.status === 'failed') return missing(state.detail);
  const rain = state.briefing.recent_rain;
  if (!rain.available || rain.last_7_days_mm === null || rain.last_30_days_mm === null) {
    return missing(rain.null_explanation ?? 'Recent rain is not connected for this field.');
  }
  return {
    available: true,
    last7DaysMm: rain.last_7_days_mm,
    last30DaysMm: rain.last_30_days_mm,
    lastRealRain: rain.last_real_rain_date,
    readThrough: rain.read_through,
    source: sourceName(rain.dataset_ids, analysis),
  };
}

function wetnessFrom(
  part: BriefingSoilWetness,
  analysis: Analysis | null,
): Reading<SoilMoisture> | null {
  if (!part.available || part.now === null || part.read_on === null) return null;
  return {
    available: true,
    now: part.now,
    usual: part.usual,
    usualLow: part.usual_low,
    usualHigh: part.usual_high,
    readOn: part.read_on,
    source: sourceName(part.dataset_ids, analysis, 'the soil moisture record'),
    wetnessScale: true,
  };
}

function rootZoneFromAnalysis(analysis: Analysis | null, waitingMessage: string): Reading<SoilMoisture> {
  if (!analysis) return missing(waitingMessage);
  const item = evidenceOf(analysis, 'soil_moisture_anomaly');
  const quantity = item?.quantity;
  if (!item || !quantity || quantity.value === null || !quantity.period) {
    return missing(quantity?.null_explanation ?? 'No soil moisture source covers this field.');
  }
  const readOn = quantity.period.end;
  const month = readOn.slice(5, 7);
  const earlier =
    analysis.series
      .find((series) => series.id === item.series_id)
      ?.points.filter((point) => point.t.slice(5, 7) === month && point.t < readOn && point.value !== null) ?? [];
  const usual =
    earlier.length > 0 ? earlier.reduce((sum, point) => sum + (point.value ?? 0), 0) / earlier.length : null;
  return {
    available: true,
    now: quantity.value,
    usual,
    usualLow: quantity.low,
    usualHigh: quantity.high,
    readOn,
    source: sourceName(quantity.dataset_ids, analysis, 'the soil moisture record'),
    wetnessScale: true,
  };
}

function weekWaterFrom(state: BriefingState, analysis: Analysis | null): Reading<WeekWater> {
  if (state.status === 'loading') return missing('We are working out water loss for the coming week.');
  if (state.status === 'failed') return missing(state.detail);
  const part = state.briefing.week_water;
  if (!part.available || part.loss_mm === null) {
    return missing(part.null_explanation ?? 'Water the soil will lose this week is not connected yet.');
  }
  return {
    available: true,
    lossMm: part.loss_mm,
    basis: part.basis,
    source: sourceName(part.dataset_ids, analysis),
  };
}

function frostWords(share: number | null, basis: string | null): string {
  const match = basis?.match(/^In (\d+) of the last (\d+) years/);
  if (match) {
    const count = Number(match[1]);
    const total = Number(match[2]);
    if (count === 0) return `None in ${total} years`;
    if (count === total) return 'Every year';
    return `${count} in ${total} years`;
  }
  if (share !== null) {
    if (share <= 0) return 'None recorded';
    if (share >= 1) return 'Every year';
    return `${Math.round(share * 100)}% of years`;
  }
  return 'Unknown';
}

function monthOutlookFrom(state: BriefingState, analysis: Analysis | null): Reading<MonthOutlook> {
  if (state.status === 'loading') return missing('We are reading the usual pattern for next month.');
  if (state.status === 'failed') return missing(state.detail);
  const part = state.briefing.month_outlook;
  if (!part.available || part.month === null || part.rain_mm === null || part.coldest_night_c === null) {
    return missing(part.null_explanation ?? 'The usual pattern for the coming month is not connected to this page yet.');
  }
  return {
    available: true,
    month: part.month,
    rainMm: { value: part.rain_mm, basis: part.rain_basis },
    coldestNightC: { value: part.coldest_night_c, basis: part.coldest_night_basis },
    frost: {
      shareOfYears: part.frost_share_of_years,
      words: frostWords(part.frost_share_of_years, part.frost_basis),
      basis: part.frost_basis,
    },
    usualPattern: part.usual_pattern,
    recordYears: state.briefing.year_climate.record_years,
    source: sourceName(part.dataset_ids, analysis),
  };
}

function yearClimateFrom(state: BriefingState, analysis: Analysis | null): Reading<YearClimate> {
  const heatFromAnalysis = analysis ? evidenceOf(analysis, 'heat_stress') : undefined;
  if (state.status === 'ready') {
    const part = state.briefing.year_climate;
    if (part.available && part.usual_rain_mm !== null) {
      return {
        available: true,
        usualRainMm: part.usual_rain_mm,
        dryYearMm: part.dry_year_mm,
        interval: part.interval ?? analysis?.uncertainty.interval ?? null,
        hotDaysPerYear: part.hot_days_per_year ?? heatFromAnalysis?.quantity.value ?? null,
        hotDayWords: heatFromAnalysis?.title ?? (part.hot_days_per_year !== null ? 'Days at or above 35 °C' : null),
        frostDaysPerYear: part.frost_days_per_year,
        hottestDayC: part.hottest_day_c,
        coldestNightC: part.coldest_night_c,
        recordYears: part.record_years,
        monthlyRainMm: part.monthly_rain_mm,
        source: sourceName(part.dataset_ids, analysis),
      };
    }
  }
  if (!analysis) {
    if (state.status === 'ready' && state.briefing.year_climate.null_explanation) {
      return missing(state.briefing.year_climate.null_explanation);
    }
    if (state.status === 'failed') return missing(state.detail);
    return missing('The long weather record arrives with your rotation results.');
  }
  const rain = evidenceOf(analysis, 'rainfall_reliability')?.quantity;
  if (!rain || rain.value === null) {
    return missing(rain?.null_explanation ?? 'No long rain record covers this field.');
  }
  const years = rain.period ? `${rain.period.start.slice(0, 4)} to ${rain.period.end.slice(0, 4)}` : null;
  return {
    available: true,
    usualRainMm: rain.value,
    dryYearMm: rain.low,
    interval: analysis.uncertainty.interval,
    hotDaysPerYear: heatFromAnalysis?.quantity.value ?? null,
    hotDayWords: heatFromAnalysis?.title ?? null,
    frostDaysPerYear: null,
    hottestDayC: null,
    coldestNightC: null,
    recordYears: years,
    monthlyRainMm: null,
    source: sourceName(rain.dataset_ids, analysis),
  };
}

function cropAdviceFrom(part: BriefingCropAdvice | null, fallback: string): Reading<CropAdvice> {
  if (!part || !part.available) {
    return missing(part?.null_explanation ?? fallback);
  }
  return {
    available: true,
    crops: part.crops,
    action: part.action,
    basis: part.basis ?? null,
  };
}

/** Everything the home screen can truthfully show today, and a reason for each thing it cannot. */
export function buildBriefing(state: BriefingState, analysis: Analysis | null): FieldBriefing {
  const forecast =
    state.status === 'loading'
      ? missing('We are fetching the forecast for your field.')
      : state.status === 'failed'
        ? missing(state.detail)
        : forecastFromOutlook(state.briefing.forecast);

  const surfaceFromBriefing = state.status === 'ready' ? wetnessFrom(state.briefing.soil_surface, analysis) : null;
  const soilSurface =
    surfaceFromBriefing ??
    (state.status === 'loading'
      ? missing('We are reading the soil moisture for your field.')
      : state.status === 'failed'
        ? missing(state.detail)
        : missing(state.briefing.soil_surface.null_explanation ?? 'Not connected yet'));

  const rootFromBriefing = state.status === 'ready' ? wetnessFrom(state.briefing.soil_root_zone, analysis) : null;
  const soilRootZone =
    rootFromBriefing ??
    rootZoneFromAnalysis(
      analysis,
      state.status === 'loading'
        ? 'Reading soil moisture for your field.'
        : state.status === 'ready' && state.briefing.soil_root_zone.null_explanation
          ? state.briefing.soil_root_zone.null_explanation
          : 'Soil moisture arrives with your rotation results.',
    );

  return {
    forecast,
    recentRain: recentRainFrom(state, analysis),
    soilSurface,
    soilRootZone,
    weekWater: weekWaterFrom(state, analysis),
    monthOutlook: monthOutlookFrom(state, analysis),
    yearClimate: yearClimateFrom(state, analysis),
    sowThisWeek: cropAdviceFrom(
      state.status === 'ready' ? state.briefing.sow_this_week : null,
      'We can’t yet say which crops to sow this week. That needs a sowing model that isn’t connected.',
    ),
    plantThisMonth: cropAdviceFrom(
      state.status === 'ready' ? state.briefing.plant_this_month : null,
      'We can’t yet say which crops to plant this month. That needs a sowing model that isn’t connected.',
    ),
  };
}
