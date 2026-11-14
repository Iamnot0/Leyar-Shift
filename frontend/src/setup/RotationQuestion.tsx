import { useImperativeHandle, useRef, useState, type Ref } from 'react';
import { labelOf, useMeta } from '../app/context';
import type { ApiError } from '../api/client';
import type { Coverage, Crop, CropHistory, RotationYear } from '../api/types';
import { Drawer } from '../components/ui/Drawer';
import { RotationEntry, type RotationEntryHandle } from '../components/ui/RotationEntry';
import { QuantityView } from '../components/ui/Values';
import { formatValue } from '../lib/format';

export type CropsState = { status: 'loading' } | { status: 'ready'; crops: Crop[] } | { status: 'failed'; error: ApiError };
export type HistoryState = { status: 'idle' } | { status: 'loading' } | { status: 'ready'; history: CropHistory } | { status: 'failed'; error: ApiError };

export interface RotationAnswer {
  /** Null when the rotation is to be read from the cropland map. */
  years: RotationYear[] | null;
  /** The farmer said the rotation read from the cropland map is right. */
  confirmed: boolean;
}

export interface RotationQuestionHandle {
  /** The answer, or null when it is incomplete. An incomplete answer says what is missing and takes focus. */
  resolve: () => RotationAnswer | null;
}

interface RotationQuestionProps {
  coverage: Coverage;
  history: HistoryState;
  crops: CropsState;
  initialYears: RotationYear[] | null;
  initialConfirmed: boolean;
  onRetryCrops: () => void;
  onRetryHistory: () => void;
  ref?: Ref<RotationQuestionHandle>;
}

/** What is grown on the field now: read from the cropland map where it reaches, entered by the farmer everywhere else. */
export function RotationQuestion({ coverage, history, crops, initialYears, initialConfirmed, onRetryCrops, onRetryHistory, ref }: RotationQuestionProps) {
  const meta = useMeta();
  const mapped = coverage.crop_history_available;
  const [entering, setEntering] = useState(!mapped || initialYears !== null);
  const [confirmed, setConfirmed] = useState(initialConfirmed);
  const [blocked, setBlocked] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);
  const entryRef = useRef<RotationEntryHandle>(null);

  useImperativeHandle(ref, () => ({
    resolve: () => {
      if (!entering) return { years: null, confirmed };
      if (crops.status !== 'ready') {
        setBlocked(true);
        sectionRef.current?.focus();
        return null;
      }
      const years = entryRef.current?.collect() ?? null;
      return years ? { years, confirmed: true } : null;
    },
  }));

  const entry = () => {
    if (crops.status === 'loading') return <p role="status">Loading the crops for this location…</p>;
    if (crops.status === 'failed') {
      return (
        <div className="state" role="alert">
          <h3 className="state__title">Could not load the crop list</h3>
          <p>{crops.error.problem.detail}</p>
          {crops.error.retryable && (
            <button type="button" className="button button--action" onClick={onRetryCrops}>
              Retry
            </button>
          )}
        </div>
      );
    }
    return <RotationEntry ref={entryRef} crops={crops.crops} initial={initialYears} />;
  };

  const detected = () => {
    if (history.status === 'failed') {
      return (
        <div className="state" role="alert">
          <h3 className="state__title">Could not read the cropland map</h3>
          <p>{history.error.problem.detail} We will try again when you compare, or you can enter your rotation.</p>
          {history.error.retryable && (
            <button type="button" className="button" onClick={onRetryHistory}>
              Retry
            </button>
          )}
        </div>
      );
    }
    if (history.status !== 'ready') return <p role="status">Reading the national cropland map for this field. The first time can take a minute…</p>;
    const found = history.history.detected;
    if (!found) {
      const years = history.history.observed_years;
      return (
        <>
          <p className="detected">
            <strong>The cropland map shows no clear rotation for this field.</strong> {history.history.null_explanation ?? 'Please enter what you grow.'}
          </p>
          {years.length > 0 && (
            <ul className="year-list">
              {years.map((observed) => (
                <li key={observed.year}>
                  <span className="readout">{observed.year}</span> {observed.class_name}, {formatValue(observed.share_of_field, 'fraction')} of the field
                </li>
              ))}
            </ul>
          )}
        </>
      );
    }
    const consistent = found.share_of_years_consistent;
    return (
      <>
        <p className="detected">
          <strong>{found.label}.</strong> Read from the national cropland map.
          {consistent.value !== null && ` It fits ${formatValue(consistent.value, consistent.unit)} of the years on record.`} {confirmed ? 'You confirmed it.' : 'Is this what you grow?'}
        </p>
        <p className="note">
          {labelOf(meta.detection_bases, found.detection_basis)}: {meta.detection_bases.find((basis) => basis.id === found.detection_basis)?.description}
        </p>
        <Drawer title="What the map shows, year by year" count={history.history.observed_years.length}>
          <ul className="year-list">
            {history.history.observed_years.map((observed) => (
              <li key={observed.year}>
                <span className="readout">{observed.year}</span> {observed.class_name}, {formatValue(observed.share_of_field, 'fraction')} of the field
              </li>
            ))}
          </ul>
          <QuantityView quantity={consistent} lead={<span className="figure__label">Years that fit:</span>} />
        </Drawer>
      </>
    );
  };

  return (
    <div ref={sectionRef} tabIndex={-1} className="rotation-question">
      {mapped && !entering && (
        <>
          {detected()}
          <div className="button-row">
            {history.status === 'ready' && history.history.detected && !confirmed && (
              <button type="button" className="button" onClick={() => setConfirmed(true)}>
                Yes, this is right
              </button>
            )}
            <button type="button" className="button" onClick={() => setEntering(true)}>
              Enter it myself instead
            </button>
          </div>
        </>
      )}
      {entering && (
        <>
          <p>
            {mapped
              ? 'Tell us what you grow, one year at a time.'
              : 'We have no crop history for this location: the national cropland map covers the United States only. Tell us what you grow, one year at a time.'}
          </p>
          {entry()}
          {mapped && (
            <button
              type="button"
              className="button"
              onClick={() => {
                setEntering(false);
                setBlocked(false);
              }}
            >
              Read it from the cropland map instead
            </button>
          )}
        </>
      )}
      {blocked && entering && crops.status !== 'ready' && (
        <p className="form-error" role="alert">
          Your rotation is needed first, and the crop list for this place has not loaded.
        </p>
      )}
    </div>
  );
}
