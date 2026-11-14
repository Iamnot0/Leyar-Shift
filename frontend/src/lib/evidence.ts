import type { AccessTier, Analysis, Dataset, EvidenceKind, Period } from '../api/types';

/** The provenance fields shared by a value, a calendar and a map layer. */
export interface Sourced {
  evidence_kind: EvidenceKind | null;
  access_tier: AccessTier | null;
  dataset_ids: string[];
  native_resolution_m?: number | null;
  period: Period | null;
  /** Absent on sources that are not counted in readings, such as a risk calendar. */
  n_valid_obs?: number | null;
  n_expected_obs?: number | null;
}

/**
 * One source standing for several numbers of the same kind, so a list carries one evidence tag instead of one per row.
 * Null when the numbers differ in kind: then each keeps its own tag. Where they were got in different ways, the shared tag leaves that line out.
 */
export function sharedSource(sources: Sourced[]): Sourced | null {
  const shown = sources.filter((source) => source.evidence_kind !== null);
  if (shown.length === 0) return null;
  const [first] = shown;
  if (shown.some((source) => source.evidence_kind !== first.evidence_kind)) return null;
  const periods = shown.flatMap((source) => (source.period ? [source.period] : []));
  return {
    evidence_kind: first.evidence_kind,
    access_tier: shown.every((source) => source.access_tier === first.access_tier) ? first.access_tier : null,
    dataset_ids: [...new Set(shown.flatMap((source) => source.dataset_ids))],
    period: periods.length === 0 ? null : { start: periods.map((period) => period.start).sort()[0], end: periods.map((period) => period.end).sort().at(-1)! },
  };
}

const SPARSE_BELOW = 0.5;
const COARSER_THAN_A_FIELD_M = 1000;

/** Fewer than half the expected readings arrived, so the value is drawn as sparse rather than confident. */
export function isSparse(source: Sourced): boolean {
  const { n_valid_obs: valid = null, n_expected_obs: expected = null } = source;
  return valid !== null && expected !== null && expected > 0 && valid / expected < SPARSE_BELOW;
}

export function datasetsFor(source: Sourced, datasets: Dataset[]): Dataset[] {
  return source.dataset_ids.flatMap((id) => datasets.find((dataset) => dataset.id === id) ?? []);
}

/** Says how much ground one reading covers, or null when the source has no pixel size. */
export function describeResolution(source: Sourced): string | null {
  const metres = source.native_resolution_m ?? null;
  if (metres === null) return null;
  if (metres >= COARSER_THAN_A_FIELD_M) return `Area average over about ${Math.round(metres / 1000)} km, not your field alone`;
  return `About ${metres} m`;
}

export interface EvidenceTally {
  counts: Record<EvidenceKind, number>;
  missing: number;
  total: number;
}

/** Counts what kind of evidence stands behind a set of values. A value with no kind is counted as missing. */
export function tallyEvidence(items: { evidence_kind: EvidenceKind | null }[]): EvidenceTally {
  const counts: Record<EvidenceKind, number> = {
    satellite_observation: 0,
    ground_observation: 0,
    soil_survey_baseline: 0,
    model_output: 0,
  };
  let missing = 0;
  for (const { evidence_kind: kind } of items) {
    if (kind === null) missing += 1;
    else counts[kind] += 1;
  }
  return { counts, missing, total: items.length };
}

/** Every figure behind the result, reduced to what kind of evidence it is. */
export function allFigures(analysis: Analysis): { evidence_kind: EvidenceKind | null }[] {
  return [
    ...analysis.field_evidence.map((item) => item.quantity),
    ...analysis.comparisons.map((pair) => pair.ground),
    ...analysis.rotations.flatMap((rotation) => [
      rotation.cover_calendar.bare_weeks_per_year,
      ...rotation.scores.map((score) => ({ evidence_kind: score.value === null ? null : (score.physical?.evidence_kind ?? ('model_output' as const)) })),
    ]),
  ];
}

/** How many of the sources reach this field and answered. */
export const coveredCount = (datasets: Dataset[]) => datasets.filter((dataset) => dataset.status === 'available').length;
