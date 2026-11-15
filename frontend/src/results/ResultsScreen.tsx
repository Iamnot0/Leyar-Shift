import type { ApiError } from '../api/client';
import { useResolvedPlace } from '../api/places';
import type { CoverageState, FieldPlan, RunState } from '../app/plan';
import { centroid } from '../lib/geo';
import type { RainfallScenario, Scenario, TemperatureScenario } from '../api/types';
import { BackIcon, InfoIcon } from '../components/ui/Icons';
import { AnswerCard, Card, CardState, Reminder } from '../components/ui/kit';
import { Segmented } from '../components/ui/Segmented';
import { HEAT_WORDS, RAIN_WORDS, REMINDER } from '../content/copy';
import { WorkingState } from '../working/WorkingState';
import { BestFitCard, MonthsCard, ScoresCard, SourcesCard, SwitchCard } from './cards';
import { FieldCard, type PictureProps } from './FieldCard';

const COMPARISON_ID = 'comparison';

const RAIN_OPTIONS = (Object.keys(RAIN_WORDS) as RainfallScenario[]).map((value) => ({ value, label: RAIN_WORDS[value] }));
const HEAT_OPTIONS = (Object.keys(HEAT_WORDS) as TemperatureScenario[]).map((value) => ({ value, label: HEAT_WORDS[value] }));

interface ResultsScreenProps extends PictureProps {
  field: FieldPlan;
  run: RunState;
  coverage: CoverageState;
  scenario: Scenario;
  rotationConfirmed: boolean;
  weatherYears: number | null;
  onScenarioChange: (scenario: Scenario) => void;
  onOpenSetup: (step: number) => void;
  onConfirmRotation: () => void;
  onRetry: () => void;
}

function Failure({ error, scenarioIsNormal, onRetry, onNormal, onOpenSetup }: { error: ApiError; scenarioIsNormal: boolean; onRetry: () => void; onNormal: () => void; onOpenSetup: () => void }) {
  if (error.retryable) {
    return (
      <Card title="We could not work out your results">
        <CardState kind="error" title="The data service did not answer." action={{ label: 'Try again', run: onRetry }}>
          {error.problem.detail} Your field and your answers are kept.
        </CardState>
      </Card>
    );
  }
  return (
    <Card title="We could not work out your results">
      <CardState kind="error" title={error.problem.title} action={scenarioIsNormal ? { label: 'Change field', run: onOpenSetup } : { label: 'Back to a normal year', run: onNormal }}>
        {error.problem.detail}
      </CardState>
    </Card>
  );
}

/** Shown on the crop rotation route when no field is set up yet or after a field is removed. */
export function EmptyResultsScreen({ onOpenSetup }: { onOpenSetup: () => void }) {
  return (
    <>
      <a className="back-link" href="/overview">
        <BackIcon />
        Today on your field
      </a>
      <h1 className="visually-hidden">Crop rotation</h1>
      <div className="row row--top">
        <AnswerCard className="wide" pill="Best fit for your field" headline="No field set up yet" smallHeadline>
          <p className="lead">Mark your field and rank your priorities to compare crop rotations side by side across many weather years.</p>
          <div className="button-row">
            <button type="button" className="button button--amber" onClick={onOpenSetup}>
              Set up your field
            </button>
          </div>
        </AnswerCard>
        <Card className="narrow" title="Your field">
          <CardState kind="empty" title="No field boundary yet" action={{ label: 'Set up your field', run: onOpenSetup }}>
            Your field map, size, water holding capacity, and bare-soil reading will appear here.
          </CardState>
        </Card>
      </div>
      <Reminder />
    </>
  );
}

/** The full yearly comparison: the answer first, then why, then what could go wrong, then where it all comes from. */
export function ResultsScreen(props: ResultsScreenProps) {
  const { field, run, coverage, scenario, rotationConfirmed, weatherYears, onScenarioChange, onOpenSetup, onConfirmRotation, onRetry, ...picture } = props;
  const scenarioIsNormal = scenario.rainfall === 'normal' && scenario.temperature === 'normal';
  const [lon, lat] = centroid(field.geometry);
  const headingPlace = useResolvedPlace(lat, lon, field.name, true, 'your field');

  return (
    <>
      <a className="back-link" href="/overview">
        <BackIcon />
        Today on your field
      </a>
      {run.status === 'running' || run.status === 'idle' ? (
        <WorkingState field={field} stage={run.status === 'running' ? run.stage : null} coverage={coverage} weatherYears={weatherYears} {...picture} />
      ) : run.status === 'failed' ? (
        <Failure error={run.error} scenarioIsNormal={scenarioIsNormal} onRetry={onRetry} onNormal={() => onScenarioChange({ rainfall: 'normal', temperature: 'normal' })} onOpenSetup={() => onOpenSetup(0)} />
      ) : (
        <>
          <h1 className="visually-hidden">Crop rotation for {headingPlace}</h1>
          <div className="row row--top">
            <BestFitCard analysis={run.analysis} comparisonId={COMPARISON_ID} onChangePriorities={() => onOpenSetup(2)} />
            <FieldCard field={field} analysis={run.analysis} {...picture} />
          </div>
          <section className="strip" aria-labelledby="kind-of-year">
            <div className="strip__body">
              <h2 id="kind-of-year" className="card__title card__title--small">
                Try a different kind of year
              </h2>
              <p className="secondary">
                See if the answer still holds when the weather turns.
                {!scenarioIsNormal && ' Everything shown for this kind of year is worked out by our model, not measured.'}
              </p>
            </div>
            <Segmented legend="Rain" inline options={RAIN_OPTIONS} value={scenario.rainfall} onChange={(rainfall) => onScenarioChange({ ...scenario, rainfall })} />
            <Segmented legend="Heat" inline options={HEAT_OPTIONS} value={scenario.temperature} onChange={(temperature) => onScenarioChange({ ...scenario, temperature })} />
          </section>
          <div className="row">
            <SwitchCard key={run.analysis.analysis_id} analysis={run.analysis} id={COMPARISON_ID} />
            <MonthsCard analysis={run.analysis} />
          </div>
          <ScoresCard analysis={run.analysis} rotationConfirmed={rotationConfirmed} onConfirmRotation={onConfirmRotation} onChangeRotation={() => onOpenSetup(3)} />
          <SourcesCard analysis={run.analysis} />
          <footer className="strip strip--tint">
            <span className="strip__icon">
              <InfoIcon />
            </span>
            <p className="strip__body">
              {REMINDER} Every number here names its source, and every rotation lists what to check on your own land.
            </p>
            <button type="button" className="button print-hidden" onClick={() => window.print()}>
              Print this for your agronomist
            </button>
          </footer>
        </>
      )}
    </>
  );
}
