import { cleanPlaceName } from '../api/places';
import type { AnalysisPlan } from './plan';

const KEY = 'field-shift-plan';
/** The best fit seen on the last visit, to say when the advice has changed. */
export const ADVICE_KEY = 'field-shift-advice';

const LEGACY_CROP_IDS: Record<string, string> = {
  cover_unspecified: 'cover_crop',
  wheat: 'winter_wheat',
  maize: 'corn',
  maize_wheat: 'corn_wheat',
  rice_maize: 'rice_corn',
};

const normalizeCropId = (id: string) => LEGACY_CROP_IDS[id] ?? id;

type SavedPlan = Omit<AnalysisPlan, 'scenario'>;

function isSavedPlan(value: unknown): value is SavedPlan {
  if (typeof value !== 'object' || value === null) return false;
  const plan = value as Partial<SavedPlan>;
  return plan.field?.geometry?.type === 'Polygon' && typeof plan.farm?.water === 'string' && Array.isArray(plan.farm.priorities);
}

/** The field and answers from the last visit, so the farmer lands on their field instead of the questions. */
export function loadSavedPlan(): SavedPlan | null {
  try {
    const stored = window.localStorage.getItem(KEY);
    const parsed: unknown = stored === null ? null : JSON.parse(stored);
    if (!isSavedPlan(parsed)) return null;
    return {
      ...parsed,
      field: { ...parsed.field, name: cleanPlaceName(parsed.field.name) },
      years: parsed.years
        ? parsed.years.map((year) => ({
            crop_id: normalizeCropId(year.crop_id),
            cover_crop_id: year.cover_crop_id ? normalizeCropId(year.cover_crop_id) : null,
          }))
        : null,
      // An empty equipment list can only be an unanswered question saved by an older version; no finished answer is empty.
      farm: {
        ...parsed.farm,
        equipment: parsed.farm.equipment?.length ? parsed.farm.equipment : null,
        ownFigures: (parsed.farm.ownFigures ?? []).map((entry) => ({ ...entry, crop_id: normalizeCropId(entry.crop_id) })),
      },
    };
  } catch {
    return null;
  }
}

/** Forgets the field and everything tied to it in this browser. The theme and other display choices stay. */
export function forgetField() {
  try {
    window.localStorage.removeItem(KEY);
    window.localStorage.removeItem(ADVICE_KEY);
  } catch {
    // Storage can be blocked. Nothing was kept, so nothing is left behind.
  }
}

export function savePlan({ field, farm, years, confirmed }: AnalysisPlan) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ field, farm, years, confirmed } satisfies SavedPlan));
  } catch {
    // Storage can be blocked. The plan still holds for this visit.
  }
}
