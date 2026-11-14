import { MONTHS } from '../lib/format';

/** A day counts as wet from this much rain. Less than this does not reach the roots. */
export const REAL_RAIN_MM = 1;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LONG_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dateOf = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`);

export const degrees = (value: number) => `${Math.round(value)}°`;
export const percent = (share: number) => `${Math.round(share * 100)}%`;

/** Whole millimetres, one decimal under 1 mm, and "Dry" when nothing measurable falls. */
export function rainWords(mm: number): string {
  if (mm < 0.1) return 'Dry';
  return mm < REAL_RAIN_MM ? `${mm.toFixed(1)} mm` : `${Math.round(mm)} mm`;
}

export const dayLabel = (isoDate: string, index: number) => (index === 0 ? 'Today' : `${WEEKDAYS[dateOf(isoDate).getUTCDay()]} ${dateOf(isoDate).getUTCDate()}`);
export const longDate = (isoDate: string) => `${LONG_WEEKDAYS[dateOf(isoDate).getUTCDay()]} ${dateOf(isoDate).getUTCDate()} ${MONTHS[dateOf(isoDate).getUTCMonth()]}`;
export const monthOf = (isoDate: string) => MONTHS[dateOf(isoDate).getUTCMonth()];
