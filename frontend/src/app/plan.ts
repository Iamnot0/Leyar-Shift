import type { ApiError } from '../api/client';
import type { Analysis, Coverage, Equipment, OwnFigures, Polygon, Priority, RotationYear, Scenario, WaterAvailability } from '../api/types';

export interface FieldPlan {
  name: string | null;
  geometry: Polygon;
}

export interface FarmDraft {
  water: WaterAvailability | null;
  /** Null means the farmer is not sure, so nothing is filtered and the gap is reported. */
  equipment: Equipment[] | null;
  priorities: Priority[];
  requireForage: boolean;
  localMarketOnly: boolean;
  ownFigures?: OwnFigures[];
}

/** Everything a comparison is asked with. */
export interface AnalysisPlan {
  field: FieldPlan;
  farm: FarmDraft;
  years: RotationYear[] | null;
  confirmed: boolean;
  scenario: Scenario;
}

export type CoverageState = { status: 'idle' } | { status: 'checking' } | { status: 'failed'; error: ApiError } | { status: 'ready'; coverage: Coverage };

/** `stage` is the id of the stage the backend says it is on, from `Meta.job_stages`. */
export type RunState = { status: 'idle' } | { status: 'running'; stage: string | null } | { status: 'failed'; error: ApiError } | { status: 'done'; analysis: Analysis };
