import { cleanPlaceName, useResolvedPlace } from '../api/places';
import { labelOf, useMeta } from '../app/context';
import type { CoverageState, FieldPlan } from '../app/plan';
import { CheckIcon } from '../components/ui/Icons';
import { coveredCount } from '../lib/evidence';
import { formatHectares } from '../lib/format';
import { areaHa, centroid } from '../lib/geo';
import { FieldPhoto, type PictureProps } from '../results/FieldCard';

const SCORING_FROM = 'building_rotations';
const WEATHER_YEARS_FROM = 'quantifying_uncertainty';

type StepState = 'done' | 'current' | 'waiting';

interface WorkingStateProps extends PictureProps {
  field: FieldPlan;
  /** The id of the stage the backend says it is on. Null until it names one. */
  stage: string | null;
  coverage: CoverageState;
  /** How many weather years the last comparison tried, when one has already been seen. */
  weatherYears: number | null;
}

function Mark({ state }: { state: StepState }) {
  if (state === 'current') return <span className="spinner" aria-hidden="true" />;
  return (
    <span className="steps__mark" aria-hidden="true">
      {state === 'done' && <CheckIcon size={16} />}
    </span>
  );
}

const STATE_WORDS: Record<StepState, string> = { done: 'Done', current: 'Working on it', waiting: 'Waiting' };

/** Shown while the comparison is worked out. The steps follow the stages the backend reports, never a timer. */
export function WorkingState({ field, stage, coverage, weatherYears, ...picture }: WorkingStateProps) {
  const meta = useMeta();
  const order = meta.job_stages.map((entry) => entry.id);
  const at = stage === null ? -1 : order.indexOf(stage);
  const scoringAt = order.indexOf(SCORING_FROM);
  const yearsAt = order.indexOf(WEATHER_YEARS_FROM);
  const staged = at >= 0 && scoringAt >= 0 && yearsAt >= 0;
  const phase = at < scoringAt ? 0 : at < yearsAt ? 1 : 2;
  const stateOf = (index: number): StepState => (index < phase ? 'done' : index === phase ? 'current' : 'waiting');

  const found = coverage.status === 'ready' ? `${coveredCount(coverage.coverage.datasets)} of ${coverage.coverage.datasets.length} sources cover it.` : '';
  const [lon, lat] = centroid(field.geometry);
  const cityCountry = useResolvedPlace(lat, lon, null, true, '');
  const title = cleanPlaceName(field.name) ?? (cityCountry || 'Your field');
  const subtitle = cityCountry && title !== cityCountry ? cityCountry : null;
  const steps = [
    { title: 'Found the data for your field', detail: phase > 0 ? `Done. ${found}` : `${labelOf(meta.job_stages, stage ?? '')}.` },
    { title: 'Scoring each rotation', detail: phase === 1 ? 'Happening now.' : phase > 1 ? 'Done.' : 'Up next.' },
    { title: weatherYears ? `Trying ${weatherYears} different weather years` : 'Trying many different weather years', detail: phase === 2 ? 'Happening now.' : 'Up next.' },
  ];

  return (
    <>
      <section className="card card--answer working" aria-labelledby="working-title">
        <div className="working__main">
          <h1 id="working-title" className="answer-headline answer-headline--small">
            Working out the best rotation for your field
          </h1>
          <p className="secondary">Your results will appear here as soon as they are ready.</p>
          <div aria-live="polite">
            {staged ? (
              <ol className="steps">
                {steps.map((step, index) => {
                  const state = stateOf(index);
                  return (
                    <li key={step.title} data-state={state}>
                      <Mark state={state} />
                      <span className="steps__title">
                        {step.title}
                        <span className="visually-hidden">: {STATE_WORDS[state]}</span>
                      </span>
                      {step.detail && <span className="steps__detail">{step.detail}</span>}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="marked">
                <span className="spinner" aria-hidden="true" />
                Getting started…
              </p>
            )}
          </div>
        </div>
        <div className="working__field">
          <FieldPhoto field={field} analysis={null} {...picture} />
          <p>
            <strong>{title}</strong>{' '}
            <span className="secondary">
              · {formatHectares(areaHa(field.geometry))} ha{subtitle ? ` · ${subtitle}` : ''}
            </span>
          </p>
        </div>
      </section>
      <div className="row" aria-hidden="true">
        <div className="card wide">
          <div className="skeleton">
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
        <div className="card narrow">
          <div className="skeleton">
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
    </>
  );
}
