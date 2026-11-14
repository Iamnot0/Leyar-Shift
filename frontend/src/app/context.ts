import { createContext, useContext } from 'react';
import type { Crop, Currency, Dataset, Label, Meta, OwnFigures } from '../api/types';

/** The backend's vocabulary. Every display label for an enumerated value is read from here. */
export const MetaContext = createContext<Meta | null>(null);

export function useMeta(): Meta {
  const meta = useContext(MetaContext);
  if (!meta) throw new Error('useMeta needs a MetaContext value above it');
  return meta;
}

export function labelOf(labels: Label[], id: string | number): string {
  return labels.find((entry) => entry.id === String(id))?.label ?? String(id);
}

export function descriptionOf(labels: Label[], id: string | number): string {
  return labels.find((entry) => entry.id === String(id))?.description ?? '';
}

export interface AnalysisScope {
  datasets: Dataset[];
  crops: Crop[];
  currency: Currency | null;
  ownFigures: OwnFigures[];
  setOwnFigures: (next: OwnFigures[]) => void;
  /** Runs the analysis again, for values that failed to load. */
  retry: () => void;
}

/** What a value needs in order to explain itself: the datasets behind it and the names of the crops. */
export const AnalysisContext = createContext<AnalysisScope>({
  datasets: [],
  crops: [],
  currency: null,
  ownFigures: [],
  setOwnFigures: () => {},
  retry: () => {},
});

export function useAnalysisScope(): AnalysisScope {
  return useContext(AnalysisContext);
}

export function cropName(crops: Crop[], id: string | null): string {
  if (!id) return 'Crop';
  const found = crops.find((crop) => crop.id === id);
  if (found) return found.name.replace(/ \(.*\)$/, '');
  return id.charAt(0).toUpperCase() + id.slice(1).replaceAll('_', ' ');
}
