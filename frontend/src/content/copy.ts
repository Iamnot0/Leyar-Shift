// Words the interface owns. The backend's vocabulary arrives by id from GET /v1/meta;
// where a farmer would name a thing differently, the plain name is kept here, keyed by the same id.

import type { CalendarHazard, CoverageScope, EvidenceKind, LocalReview, NullReason, Priority, RainfallScenario, Rotation, ScoreId, TemperatureScenario, WaterAvailability } from '../api/types';
import type { FieldProblem } from '../lib/geo';

export const REMINDER = 'Leyar Shift helps you decide. It doesn’t decide for you. Talk it through with your local agronomist first.';

export const SETUP_STEPS = ['Your field', 'Equipment', 'What matters most', 'What you grow'] as const;
export const NEXT_STEP_WORDS = ['your equipment', 'what matters most', 'what you grow'] as const;

export const SCORE_WORDS: Record<ScoreId, string> = {
  water_balance: 'Water needed',
  soil_health: 'Soil health',
  erosion: 'Soil washing away',
  climate_risk: 'Risk from bad weather',
  pest_break: 'Breaking pest cycles',
  economics: 'Income',
};

export const PRIORITY_WORDS: Record<Priority, string> = {
  conserve_water: 'Use less water',
  build_soil: 'Build soil health',
  reduce_erosion: 'Stop soil washing away',
  lower_weather_risk: 'Lower the risk from bad weather',
  break_pest_cycles: 'Break pest cycles',
  income: 'Income',
};

export const RISK_WORDS: Record<CalendarHazard, string> = {
  frost: 'Frost',
  heat: 'Heat on the crop',
  dry_spell: 'Dry spell',
  extreme_rain: 'Heavy rain',
  bare_field: 'Bare soil',
};

/** The risk as the subject of a sentence, and what makes its months matter. */
export const RISK_SUBJECT: Record<CalendarHazard, { name: string; when: string }> = {
  frost: { name: 'Frost', when: ', when the crop is easy to damage' },
  heat: { name: 'Heat', when: ', when the crop is easy to damage' },
  dry_spell: { name: 'Dry weather', when: ', while a crop is growing' },
  extreme_rain: { name: 'Heavy rain', when: '' },
  bare_field: { name: 'Bare soil', when: '' },
};

export const EVIDENCE_WORDS: Record<EvidenceKind, string> = {
  satellite_observation: 'Measured by satellite',
  ground_observation: 'Measured on the ground',
  soil_survey_baseline: 'From the soil survey',
  model_output: 'Worked out by our model',
};

export const NULL_REASON_WORDS: Record<NullReason, string> = {
  out_of_coverage: 'Doesn’t reach this area',
  not_configured: 'Not connected yet',
  insufficient_observations: 'Too few readings',
  fetch_failed: 'Could not load',
};

export const RAIN_WORDS: Record<RainfallScenario, string> = { normal: 'Normal', dry: 'Dry', very_dry: 'Very dry' };
export const HEAT_WORDS: Record<TemperatureScenario, string> = { normal: 'Normal', warm: 'Warm', hot: 'Hot' };

export const WATER_OPTIONS: { value: WaterAvailability; label: string; help: string }[] = [
  { value: 'rain_fed', label: 'Rain only', help: 'No irrigation.' },
  { value: 'limited', label: 'Some irrigation', help: 'A well or canal that cannot always keep up.' },
  { value: 'reliable', label: 'Reliable irrigation', help: 'Water when the crop needs it.' },
];

export const REVIEWER_WORDS: Record<LocalReview['reviewer'], string> = {
  farmer: 'you know this best',
  agronomist: 'your agronomist',
  extension_service: 'your extension service',
  water_authority: 'your water authority',
  buyer: 'your buyer',
};

export const CHANGE_LEVEL_WORDS: Record<Rotation['change_level'], string> = {
  none: '',
  low: 'A small change from what you grow now.',
  high: 'A bigger change from what you grow now.',
};

export const COVERAGE_WORDS: Record<CoverageScope, string> = {
  global: 'Worldwide',
  us_only: 'United States only',
  western_us: 'Western United States only',
};

export const FIELD_PROBLEM_COPY: Record<FieldProblem, string> = {
  too_few_corners: 'Mark at least three corners to make a field.',
  crosses_itself: 'The field edge crosses itself. Move a corner so no two sides cross.',
  too_small: 'This is smaller than half a hectare. Fields must be between 0.5 and 2,000 hectares.',
  too_large: 'This is larger than 2,000 hectares. Fields must be between 0.5 and 2,000 hectares.',
};

export const COMPOSITE_NOTE = 'A score out of 100, built from several measures. Higher is better.';
