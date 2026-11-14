import type { Currency, Period } from '../api/types';

const MINUS = '−';

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

interface UnitWords {
  one: string;
  many: string;
  /** Multiplies the value before display, for fractions shown as percentages. */
  scale?: number;
  /** Written against the number, with no space. */
  attached?: boolean;
}

const same = (words: string): UnitWords => ({ one: words, many: words });

/** Plain words for every unit string the backend emits. An unknown unit is shown as it arrives. */
const UNITS: Record<string, UnitWords> = {
  'mm/yr': same('mm a year'),
  'weeks/yr': { one: 'week a year', many: 'weeks a year' },
  'days/yr': { one: 'day a year', many: 'days a year' },
  days: { one: 'day', many: 'days' },
  years: { one: 'year', many: 'years' },
  fraction: { one: '%', many: '%', scale: 100, attached: true },
  percent: { one: '%', many: '%', attached: true },
  degC: { one: '°C', many: '°C', attached: true },
  m: same('m'),
  ha: { one: 'hectare', many: 'hectares' },
  'mm/m': same('mm of water per metre of soil'),
  'm3/m3': { one: "% of the soil's volume", many: "% of the soil's volume", scale: 100, attached: true },
  'cm/yr': same('cm of water a year'),
  index: same(''),
  count: same(''),
  'lb/acre': same('pounds per acre'),
  ft: same('ft'),
  'ft/yr': same('ft a year'),
  'bu/acre': same('bushels per acre'),
  'tons/acre': same('tons per acre'),
};

const MONEY_SUFFIXES: Record<string, string> = {
  'ha/yr': 'per hectare a year',
  t: 'per tonne',
  bu: 'per bushel',
  cwt: 'per hundredweight',
  ton: 'per ton',
};

function moneyUnitWords(unit: string, currency?: Currency | null): UnitWords | undefined {
  if (!currency) return undefined;
  const prefix = `${currency.code}/`;
  if (!unit.startsWith(prefix)) return undefined;
  const per = unit.slice(prefix.length);
  const perWords = MONEY_SUFFIXES[per] ?? `per ${per}`;
  return same(`${currency.name} ${perWords}`);
}

export function formatNumber(value: number): string {
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Number(value.toFixed(Math.abs(value) < 10 ? 2 : 1));
  return String(rounded).replace('-', MINUS);
}

function withUnit(amount: string, magnitude: number, unit: string, currency?: Currency | null): string {
  const words = UNITS[unit] ?? moneyUnitWords(unit, currency);
  if (!words) return unit ? `${amount} ${unit}` : amount;
  const text = Math.abs(magnitude) === 1 ? words.one : words.many;
  if (!text) return amount;
  return words.attached ? `${amount}${text}` : `${amount} ${text}`;
}

const scaled = (value: number, unit: string) => value * (UNITS[unit]?.scale ?? 1);

export function formatValue(value: number, unit: string, currency?: Currency | null): string {
  const shown = scaled(value, unit);
  return withUnit(formatNumber(shown), shown, unit, currency);
}

export function formatRange(low: number, high: number, unit: string, currency?: Currency | null): string {
  const shownHigh = scaled(high, unit);
  return withUnit(`${formatNumber(scaled(low, unit))} to ${formatNumber(shownHigh)}`, shownHigh, unit, currency);
}

export function formatPeriod(period: Period): string {
  const start = new Date(`${period.start}T00:00:00Z`);
  const end = new Date(`${period.end}T00:00:00Z`);
  const wholeYears = start.getUTCMonth() === 0 && start.getUTCDate() === 1 && end.getUTCMonth() === 11 && end.getUTCDate() === 31;
  if (wholeYears) {
    return start.getUTCFullYear() === end.getUTCFullYear() ? String(start.getUTCFullYear()) : `${start.getUTCFullYear()} to ${end.getUTCFullYear()}`;
  }
  const monthYear = (date: Date) => `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  return monthYear(start) === monthYear(end) ? monthYear(start) : `${monthYear(start)} to ${monthYear(end)}`;
}

/** "5 November 2026" from an ISO date. */
export function formatDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

export function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A value rounded for people: a whole number with its unit in plain words. */
export function formatWhole(value: number, unit: string, currency?: Currency | null): string {
  const shown = Math.round(scaled(value, unit));
  return withUnit(shown.toLocaleString('en-US').replace('-', MINUS), shown, unit, currency);
}

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** "three" for 3. Larger counts stay as digits. */
export function numberWord(count: number): string {
  return NUMBER_WORDS[count] ?? String(count);
}

export function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * "June to October" for a run of months, "September to March" for one that crosses the new year,
 * and "March, and June to August" when they fall apart.
 */
export function monthSpanWords(months: number[]): string {
  if (months.length === 0) return '';
  if (months.length === MONTHS.length) return 'all year';
  const marked = new Set(months);
  const starts = months.filter((month) => !marked.has((month + 11) % 12));
  const runs = starts.map((start) => {
    let length = 1;
    while (marked.has((start + length) % 12)) length += 1;
    const end = (start + length - 1) % 12;
    if (length === 1) return MONTHS[start];
    return length === 2 ? `${MONTHS[start]} and ${MONTHS[end]}` : `${MONTHS[start]} to ${MONTHS[end]}`;
  });
  return joinList(runs);
}

/** A field's size to one decimal place: "4.1". */
export function formatHectares(hectares: number): string {
  return formatNumber(Number(hectares.toFixed(1)));
}
