import { useId, useMemo, useState, type FormEvent } from 'react';
import type { Crop, OwnFigures, Rotation } from '../api/types';
import { cropName, useAnalysisScope } from '../app/context';

const PAIR_CROPS: Record<string, string[]> = {
  rice_wheat: ['rice', 'winter_wheat'],
  corn_wheat: ['corn', 'winter_wheat'],
  cotton_wheat: ['cotton', 'winter_wheat'],
  pulses_wheat: ['dry_beans', 'winter_wheat'],
  rice_rice: ['rice'],
  rice_corn: ['rice', 'corn'],
  rice_pulses: ['rice', 'dry_beans'],
  wheat_sorghum: ['winter_wheat', 'sorghum'],
  wheat_soybean: ['winter_wheat', 'soybean'],
};

const SKIP_CROPS = new Set(['fallow', 'cover_crop', 'cover_unspecified']);

export interface SingleCropItem {
  id: string;
  name: string;
}

/** Decompose rotation years into unique constituent single crop IDs from `GET /v1/crops`. */
function singleCropsFor(rotations: Rotation[], availableCrops: Crop[]): SingleCropItem[] {
  const availableIds = new Set(availableCrops.map((crop) => crop.id));
  const coverIds = new Set(availableCrops.filter((crop) => crop.category === 'cover').map((crop) => crop.id));
  const seen = new Set<string>();
  const items: SingleCropItem[] = [];

  const pushId = (id: string) => {
    if (SKIP_CROPS.has(id) || coverIds.has(id) || seen.has(id)) return;
    if (availableIds.size > 0 && !availableIds.has(id)) return;
    seen.add(id);
    items.push({ id, name: cropName(availableCrops, id) });
  };

  for (const rotation of rotations) {
    for (const year of rotation.years) {
      const id = year.crop_id;
      if (SKIP_CROPS.has(id) || coverIds.has(id)) continue;

      const pair = PAIR_CROPS[id];
      if (pair) {
        for (const singleId of pair) pushId(singleId);
        continue;
      }

      const cropObj = availableCrops.find((crop) => crop.id === id);
      const isNamedPair = cropObj ? /\((?:two crops a year|same year)\)|twice a year/i.test(cropObj.name) : false;

      if (!isNamedPair && (availableIds.size === 0 || availableIds.has(id))) {
        pushId(id);
        continue;
      }

      if (id.includes('_')) {
        const parts = id.split('_');
        if (parts.length > 1 && parts.every((part) => availableIds.has(part))) {
          for (const part of parts) pushId(part);
        }
      }
    }
  }

  return items;
}

interface DraftValues {
  yieldText: string;
  priceText: string;
}

function buildDrafts(crops: SingleCropItem[], current: OwnFigures[]): Record<string, DraftValues> {
  const byId = new Map(current.map((entry) => [entry.crop_id, entry]));
  const drafts: Record<string, DraftValues> = {};
  for (const crop of crops) {
    const saved = byId.get(crop.id);
    drafts[crop.id] = {
      yieldText: saved ? String(saved.yield_t_per_ha) : '',
      priceText: saved ? String(saved.price_per_tonne) : '',
    };
  }
  return drafts;
}

export function OwnFiguresControl({ rotations }: { rotations: Rotation[] }) {
  const { crops, currency, ownFigures, setOwnFigures } = useAnalysisScope();
  const baseId = useId();
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, DraftValues>>({});
  const [error, setError] = useState<string | null>(null);

  const cropList = useMemo(() => singleCropsFor(rotations, crops), [rotations, crops]);
  const cropIds = useMemo(() => new Set(cropList.map((crop) => crop.id)), [cropList]);
  const hasSaved = useMemo(
    () => ownFigures.some((entry) => cropIds.has(entry.crop_id)),
    [ownFigures, cropIds],
  );

  if (cropList.length === 0) return null;

  const openEditor = () => {
    setDrafts(buildDrafts(cropList, ownFigures));
    setError(null);
    setOpen(true);
  };

  const toggle = () => {
    if (open) {
      setOpen(false);
      setError(null);
    } else {
      openEditor();
    }
  };

  const updateField = (cropId: string, key: keyof DraftValues, value: string) => {
    setError(null);
    setDrafts((prev) => ({
      ...prev,
      [cropId]: {
        yieldText: prev[cropId]?.yieldText ?? '',
        priceText: prev[cropId]?.priceText ?? '',
        [key]: value,
      },
    }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const updatedForScope: OwnFigures[] = [];

    for (const crop of cropList) {
      const draft = drafts[crop.id] ?? { yieldText: '', priceText: '' };
      const yTrim = draft.yieldText.trim();
      const pTrim = draft.priceText.trim();

      if (yTrim === '' && pTrim === '') continue;
      if (yTrim === '' || pTrim === '') {
        setError(`Enter both yield and selling price for ${crop.name}, or leave both empty.`);
        return;
      }

      const yieldVal = Number(yTrim);
      if (!Number.isFinite(yieldVal) || yieldVal <= 0 || yieldVal > 100) {
        setError(`Yield for ${crop.name} must be above 0 and at most 100 tonnes per hectare.`);
        return;
      }

      const priceVal = Number(pTrim);
      if (!Number.isFinite(priceVal) || priceVal <= 0) {
        const unitLabel = currency?.name ? ` ${currency.name}` : '';
        setError(`Selling price for ${crop.name} must be above 0${unitLabel} per tonne.`);
        return;
      }

      updatedForScope.push({
        crop_id: crop.id,
        yield_t_per_ha: yieldVal,
        price_per_tonne: priceVal,
      });
    }

    const preserved = ownFigures.filter((entry) => !cropIds.has(entry.crop_id));
    setOwnFigures([...preserved, ...updatedForScope]);
    setOpen(false);
    setError(null);
  };

  const handleClear = () => {
    const remaining = ownFigures.filter((entry) => !cropIds.has(entry.crop_id));
    setOwnFigures(remaining);
    setOpen(false);
    setError(null);
  };

  return (
    <div className="own-prices">
      <button
        type="button"
        className="button own-prices__toggle"
        aria-expanded={open}
        onClick={toggle}
      >
        {hasSaved ? 'Edit my yield and price' : 'Use my own yield and price'}
      </button>

      {open && (
        <form className="own-prices__form" onSubmit={handleSubmit} noValidate>
          {cropList.map((crop) => {
            const draft = drafts[crop.id] ?? { yieldText: '', priceText: '' };
            const yieldId = `${baseId}-${crop.id}-yield`;
            const priceId = `${baseId}-${crop.id}-price`;
            return (
              <fieldset key={crop.id} className="own-prices__crop">
                <legend className="own-prices__name">{crop.name}</legend>
                <div className="own-prices__fields">
                  <div className="field">
                    <label htmlFor={yieldId}>Yield (tonnes per hectare)</label>
                    <input
                      id={yieldId}
                      type="number"
                      step="any"
                      min="0"
                      max="100"
                      inputMode="decimal"
                      value={draft.yieldText}
                      onChange={(e) => updateField(crop.id, 'yieldText', e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={priceId}>Selling price (per tonne)</label>
                    <div className="input-row">
                      <input
                        id={priceId}
                        type="number"
                        step="any"
                        min="0"
                        inputMode="decimal"
                        value={draft.priceText}
                        onChange={(e) => updateField(crop.id, 'priceText', e.target.value)}
                      />
                      {currency?.name && (
                        <span className="own-prices__currency">{currency.name}</span>
                      )}
                    </div>
                  </div>
                </div>
              </fieldset>
            );
          })}

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <div className="button-row">
            <button type="submit" className="button button--primary">
              Update income
            </button>
            {hasSaved && (
              <button type="button" className="button" onClick={handleClear}>
                Clear saved prices
              </button>
            )}
            <button
              type="button"
              className="button"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
