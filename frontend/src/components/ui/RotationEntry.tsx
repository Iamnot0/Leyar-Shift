import { useId, useImperativeHandle, useRef, useState, type FormEvent, type Ref } from 'react';
import type { Crop, RotationYear } from '../../api/types';

const MAX_YEARS = 8;

interface YearDraft {
  key: number;
  cropId: string;
  coverCrop: boolean;
}

interface Draft {
  years: YearDraft[];
  nextKey: number;
}

function toDraft(initial: RotationYear[] | null): Draft {
  const years: YearDraft[] = initial
    ? initial.map((year, key) => ({ key, cropId: year.crop_id, coverCrop: Boolean(year.cover_crop_id) }))
    : [{ key: 0, cropId: '', coverCrop: false }];
  return { years, nextKey: years.length };
}

export interface RotationEntryHandle {
  /** Checks the entry, says what is missing, and returns the rotation once it is complete. */
  collect: () => RotationYear[] | null;
}

interface RotationEntryProps {
  /** The crops the backend accepts at this location, from GET /v1/crops. */
  crops: Crop[];
  initial: RotationYear[] | null;
  /** With this the entry is a form of its own. Without it the entry is one question in a larger form, which collects it through `ref`. */
  submit?: { label: string; onSubmit: (years: RotationYear[]) => void; onCancel?: () => void };
  ref?: Ref<RotationEntryHandle>;
}

/** The farmer's own rotation, one entry per year. Required wherever no crop history source covers the field. */
export function RotationEntry({ crops, initial, submit, ref }: RotationEntryProps) {
  const formId = useId();
  const [draft, setDraft] = useState(() => toDraft(initial));
  const [yearErrors, setYearErrors] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const selects = useRef(new Map<number, HTMLSelectElement>());

  const grown = crops.filter((crop) => crop.category === 'cash' || crop.category === 'forage');
  const fallow = crops.find((crop) => crop.category === 'fallow');
  const coverCrop = crops.find((crop) => crop.category === 'cover');
  const growsCrop = (year: YearDraft) => year.cropId !== '' && year.cropId !== fallow?.id;

  const updateYear = (key: number, change: Partial<YearDraft>) => {
    setDraft((current) => ({ ...current, years: current.years.map((year) => (year.key === key ? { ...year, ...change } : year)) }));
    setYearErrors((current) => Object.fromEntries(Object.entries(current).filter(([yearKey]) => Number(yearKey) !== key)));
    setFormError(null);
  };

  const addYear = () => {
    setDraft((current) => ({ years: [...current.years, { key: current.nextKey, cropId: '', coverCrop: false }], nextKey: current.nextKey + 1 }));
  };

  const removeYear = (key: number) => {
    const index = draft.years.findIndex((year) => year.key === key);
    const neighbour = draft.years[index - 1] ?? draft.years[index + 1];
    setDraft((current) => ({ ...current, years: current.years.filter((year) => year.key !== key) }));
    selects.current.get(neighbour.key)?.focus();
  };

  const collect = (): RotationYear[] | null => {
    const errors: Record<number, string> = {};
    draft.years.forEach((year, index) => {
      if (year.cropId === '') errors[year.key] = `Choose what you grow in year ${index + 1}.`;
    });
    const firstInvalid = draft.years.find((year) => errors[year.key]);
    const noCrop = !firstInvalid && !draft.years.some(growsCrop);

    setYearErrors(errors);
    setFormError(noCrop ? 'A rotation needs at least one crop. Fallow alone leaves nothing to compare.' : null);
    if (firstInvalid || noCrop) {
      selects.current.get((firstInvalid ?? draft.years[0]).key)?.focus();
      return null;
    }
    return draft.years.map((year) => ({ crop_id: year.cropId, cover_crop_id: year.coverCrop && growsCrop(year) && coverCrop ? coverCrop.id : null }));
  };
  useImperativeHandle(ref, () => ({ collect }));

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const years = collect();
    if (years) submit?.onSubmit(years);
  };
  const addYearButton = draft.years.length < MAX_YEARS && (
    <button type="button" className="button" onClick={addYear}>
      Add another year
    </button>
  );

  const years = (
    <>
      {formError && (
        <p className="form-error" role="alert" id={`${formId}-error`}>
          {formError}
        </p>
      )}
      <ol className="rotation-entry__years">
        {draft.years.map((year, index) => {
          const selectId = `${formId}-year-${year.key}`;
          const error = yearErrors[year.key];
          return (
            <li key={year.key} className="rotation-entry__year">
              <label htmlFor={selectId}>Year {index + 1}</label>
              <select
                id={selectId}
                ref={(element) => {
                  if (element) selects.current.set(year.key, element);
                  else selects.current.delete(year.key);
                }}
                value={year.cropId}
                required
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${selectId}-error` : formError ? `${formId}-error` : undefined}
                onChange={(event) => updateYear(year.key, { cropId: event.target.value })}
              >
                <option value="">Choose a crop</option>
                {grown.map((crop) => (
                  <option key={crop.id} value={crop.id}>
                    {crop.name}
                    {crop.suitable === false ? ' (not usually grown here)' : ''}
                  </option>
                ))}
                {fallow && <option value={fallow.id}>{fallow.name}</option>}
              </select>
              {error && (
                <p className="form-error" id={`${selectId}-error`}>
                  {error}
                </p>
              )}
              {coverCrop && (
                <label className="check">
                  <input type="checkbox" checked={year.coverCrop && growsCrop(year)} disabled={!growsCrop(year)} onChange={(event) => updateYear(year.key, { coverCrop: event.target.checked })} />
                  <span>Cover crop after harvest</span>
                </label>
              )}
              {draft.years.length > 1 && (
                <button type="button" className="button" onClick={() => removeYear(year.key)}>
                  Remove year {index + 1}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );

  if (!submit) {
    return (
      <div className="rotation-entry">
        {years}
        <div className="button-row">{addYearButton}</div>
      </div>
    );
  }
  return (
    <form className="rotation-entry" noValidate onSubmit={handleSubmit}>
      {years}
      <div className="button-row">
        {addYearButton}
        <button type="submit" className="button button--action">
          {submit.label}
        </button>
        {submit.onCancel && (
          <button type="button" className="button" onClick={submit.onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
