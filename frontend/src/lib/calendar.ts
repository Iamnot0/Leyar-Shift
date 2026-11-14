import type { CalendarHazard, CoverCell, CoverState, RiskCell, RiskLevel } from '../api/types';
import { MONTHS, joinList, sentenceCase } from './format';

export interface Run {
  state: CoverState;
  cropId: string | null;
  /** Month index, 0-11. */
  start: number;
  length: number;
}

/** The calendar's cells as one row of twelve months per cycle year. */
export function yearsOf(cells: CoverCell[]): CoverCell[][] {
  const years = new Map<number, CoverCell[]>();
  for (const cell of cells) years.set(cell.cycle_year, [...(years.get(cell.cycle_year) ?? []), cell]);
  return [...years.entries()].sort(([a], [b]) => a - b).map(([, months]) => months.sort((a, b) => a.month - b.month));
}

/** Merges consecutive months in the same state into one segment. */
export function toRuns(months: CoverCell[]): Run[] {
  const runs: Run[] = [];
  for (const cell of months) {
    const last = runs.at(-1);
    if (last && last.state === cell.state && last.cropId === cell.crop_id && last.start + last.length === cell.month - 1) last.length += 1;
    else runs.push({ state: cell.state, cropId: cell.crop_id, start: cell.month - 1, length: 1 });
  }
  return runs;
}

function monthSpan(start: number, length: number): string {
  if (length === 12) return 'all year';
  return length === 1 ? MONTHS[start] : `${MONTHS[start]} to ${MONTHS[start + length - 1]}`;
}

/** Plain-language equivalent of one ribbon row, for readers who cannot use the graphic. */
export function describeYear(months: CoverCell[], stateWords: (state: CoverState) => string, cropWords: (id: string | null) => string): string {
  const spans = new Map<string, string[]>();
  for (const run of toRuns(months)) {
    const subject = (run.state === 'crop' ? cropWords(run.cropId) : stateWords(run.state)).toLowerCase();
    spans.set(subject, [...(spans.get(subject) ?? []), monthSpan(run.start, run.length)]);
  }
  return `${sentenceCase([...spans].map(([subject, periods]) => `${subject} ${joinList(periods)}`).join('; '))}.`;
}

export interface MonthRisk {
  level: RiskLevel | null;
  /** Share of years in the record in which the hazard occurred in this month. */
  share: number | null;
}

/** One hazard's twelve months, taking the worst cycle year for each month. */
export function monthlyRisk(cells: RiskCell[], hazard: CalendarHazard): MonthRisk[] {
  return MONTHS.map((_, index) => {
    const month = cells.filter((cell) => cell.hazard === hazard && cell.month === index + 1 && cell.level !== null);
    if (month.length === 0) return { level: null, share: null };
    const worst = month.reduce((a, b) => ((b.level ?? 0) > (a.level ?? 0) ? b : a));
    return { level: worst.level, share: worst.share_of_years };
  });
}
