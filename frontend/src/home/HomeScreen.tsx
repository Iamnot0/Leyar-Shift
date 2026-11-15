import { useEffect, useMemo, useState } from 'react';
import { toApiError, type ApiClient } from '../api/client';
import { buildBriefing, type BriefingState, type CropAdvice, type FieldBriefing, type Reading } from '../api/fieldBriefing';
import { cleanPlaceName, useResolvedPlace } from '../api/places';
import { useAnalysisScope } from '../app/context';
import type { AnalysisPlan, RunState } from '../app/plan';
import type { Analysis } from '../api/types';
import { BellIcon } from '../components/ui/Icons';
import { AnswerCard, Card, CardState, Pill, Reminder, ToggleGroup } from '../components/ui/kit';
import { CropIllustration } from './CropIllustration';
import { EXAMPLE_FIELDS, type ExampleField } from '../content/examples';
import { HEAT_WORDS, RAIN_WORDS } from '../content/copy';
import { coveredCount } from '../lib/evidence';
import { formatDay } from '../lib/format';
import { centroid } from '../lib/geo';
import { bestOf, byRank, shortName } from '../results/reading';
import { MonthOutlookCard, RainCard, SoilCard, SuggestedCropsCard, WeatherCard, WeekOutlook, YearOutlook } from './cards';
import { groundOf } from './ground';
import { REAL_RAIN_MM, degrees, longDate, monthOf } from './words';
import { ADVICE_KEY } from '../app/saved';

const FORECAST_REFRESH_MS = 30 * 60 * 1000;
const WEEK_DAYS = 7;
const HORIZON_KEY = 'field-shift-horizon';

type Horizon = 'week' | 'month' | 'year';
const HORIZONS: { value: Horizon; label: string }[] = [
  { value: 'week', label: 'Next 7 days' },
  { value: 'month', label: 'Next month' },
  { value: 'year', label: 'This year' },
];

function storedHorizon(): Horizon {
  try {
    const stored = window.localStorage.getItem(HORIZON_KEY);
    return HORIZONS.find((horizon) => horizon.value === stored)?.value ?? 'week';
  } catch {
    return 'week';
  }
}

/** Weather, rain, soil wetness, and the longer pattern for a place, fetched on arrival and again as it ages. */
function useBriefing(client: ApiClient, lat: number, lon: number): [BriefingState, () => void] {
  const [state, setState] = useState<BriefingState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    let fetchedAt = 0;
    const load = () => {
      fetchedAt = Date.now();
      client
        .getBriefing(lat, lon)
        .then((briefing) => current && setState({ status: 'ready', briefing }))
        // A refresh that fails leaves the last briefing on screen. Only a first fetch that fails is shown as a failure.
        .catch((error: unknown) => current && setState((shown) => (shown.status === 'ready' ? shown : { status: 'failed', detail: toApiError(error).problem.detail })));
    };
    const onReturn = () => {
      if (document.visibilityState === 'visible' && Date.now() - fetchedAt >= FORECAST_REFRESH_MS) load();
    };
    load();
    const timer = window.setInterval(load, FORECAST_REFRESH_MS);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [client, lat, lon, attempt]);
  return [state, () => setAttempt((count) => count + 1)];
}

interface SeenAdvice {
  field: string;
  best: string;
  seenOn: string;
}

function readSeenAdvice(field: string): SeenAdvice | null {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(ADVICE_KEY) ?? 'null');
    const seen = stored as SeenAdvice | null;
    return seen && seen.field === field && typeof seen.best === 'string' && typeof seen.seenOn === 'string' ? seen : null;
  } catch {
    return null;
  }
}

/** What the advice was on the last visit to this field, so a change can be pointed out. */
function useLastVisit(field: string, best: string | null): SeenAdvice | null {
  const [seen] = useState(() => readSeenAdvice(field));
  useEffect(() => {
    if (best === null) return;
    try {
      window.localStorage.setItem(ADVICE_KEY, JSON.stringify({ field, best, seenOn: new Date().toISOString().slice(0, 10) } satisfies SeenAdvice));
    } catch {
      // Storage can be blocked. The change note is then left out on the next visit.
    }
  }, [field, best]);
  return seen;
}

function summaryOf(briefing: FieldBriefing): string {
  const parts: string[] = [];
  if (briefing.forecast.available) {
    const [today] = briefing.forecast.days;
    const sky = today.rainMm >= REAL_RAIN_MM ? 'Rain today' : 'Dry today';
    const extra = today.frost ? ', with frost tonight' : today.heat ? ', and very hot' : '';
    parts.push(`${sky}${extra}, with a high of ${degrees(today.highC)}.`);
  } else if (briefing.recentRain.available) {
    parts.push(
      briefing.recentRain.last7DaysMm < REAL_RAIN_MM
        ? 'No real rain in the last 7 days.'
        : `${Math.round(briefing.recentRain.last7DaysMm)} mm of rain in the last 7 days.`,
    );
  }
  const surface = briefing.soilSurface;
  const root = briefing.soilRootZone;
  if (
    surface.available &&
    surface.usualLow !== null &&
    surface.now < surface.usualLow &&
    root.available &&
    (root.usualLow === null || root.now >= root.usualLow)
  ) {
    parts.push(`The top of the soil is drier than usual for ${monthOf(surface.readOn)}, while deeper soil still holds water.`);
  } else if (root.available) {
    const month = monthOf(root.readOn);
    if (root.usualLow !== null && root.now < root.usualLow) parts.push(`The soil is drier than usual for ${month}, so anything you sow now will need watering.`);
    else if (root.usualHigh !== null && root.now > root.usualHigh) parts.push(`The soil is wetter than usual for ${month}.`);
    else parts.push(`The soil holds about as much water as usual for ${month}.`);
  }
  return parts.length > 0 ? parts.join(' ') : 'We are gathering today’s readings for your field.';
}

function HorizonActions({ horizon, onChooseHorizon }: { horizon: Horizon; onChooseHorizon: (next: Horizon) => void }) {
  if (horizon === 'week') {
    return (
      <div className="button-row">
        <button type="button" className="button button--amber" onClick={() => onChooseHorizon('month')}>
          See next month
        </button>
        <button type="button" className="button button--on-deep" onClick={() => onChooseHorizon('year')}>
          See this year
        </button>
      </div>
    );
  }
  if (horizon === 'month') {
    return (
      <div className="button-row">
        <button type="button" className="button button--amber" onClick={() => onChooseHorizon('year')}>
          See this year
        </button>
        <button type="button" className="button button--on-deep" onClick={() => onChooseHorizon('week')}>
          See next 7 days
        </button>
      </div>
    );
  }
  return (
    <div className="button-row">
      <a className="button button--amber" href="/results">
        See your crop rotation
      </a>
      <button type="button" className="button button--on-deep" onClick={() => onChooseHorizon('week')}>
        See next 7 days
      </button>
      <button type="button" className="button button--on-deep" onClick={() => onChooseHorizon('month')}>
        See next month
      </button>
    </div>
  );
}

function AdviceCard({
  pill,
  horizon,
  advice,
  actionLead,
  onChooseHorizon,
}: {
  pill: string;
  horizon: 'week' | 'month';
  advice: Reading<CropAdvice>;
  actionLead: string;
  onChooseHorizon: (next: Horizon) => void;
}) {
  // "Best to sow" only heads a card that names a crop to sow.
  const neutralPill = horizon === 'week' ? 'Sowing this week' : 'Planting this month';
  if (!advice.available) {
    return (
      <AnswerCard className="narrow" pill={neutralPill} headline="We can’t say yet" smallHeadline>
        <p>{advice.why} Your best rotation for the year is ready.</p>
        <HorizonActions horizon={horizon} onChooseHorizon={onChooseHorizon} />
      </AnswerCard>
    );
  }
  const good = advice.crops.filter((crop) => crop.good).slice(0, 2);
  const hasHold = advice.crops.some((crop) => crop.verdict.includes('Hold') || crop.verdict.includes('Frost') || crop.verdict.includes('Too wet'));
  const hasPrep = advice.crops.some((crop) => crop.verdict === 'Prep ahead');
  const headline =
    good.length > 0 ? good.map((crop) => crop.name).join(' and ') : hasHold ? 'Hold off seeding' : hasPrep ? 'Prepare to plant' : 'Out of sowing season';
  return (
    <AnswerCard className="narrow" pill={good.length > 0 ? pill : neutralPill} headline={headline} smallHeadline>
      <ul className="ranked">
        {advice.crops.map((crop) => (
          <li key={crop.name} className={crop.good ? 'ranked__best' : undefined}>
            <p className="ranked__top">
              <span>{crop.name}</span>
              <span>{crop.verdict}</span>
            </p>
            <p className="secondary">{crop.reason}</p>
          </li>
        ))}
      </ul>
      <p>
        <strong>{actionLead}</strong> {advice.action}
      </p>
      <HorizonActions horizon={horizon} onChooseHorizon={onChooseHorizon} />
    </AnswerCard>
  );
}

function YearAnswer({ run, onRetry, onChooseHorizon }: { run: RunState; onRetry: () => void; onChooseHorizon: (next: Horizon) => void }) {
  const pill = 'Best rotation for the year';
  if (run.status === 'failed') {
    return (
      <AnswerCard className="narrow" pill={pill} headline="We could not work it out" smallHeadline>
        <CardState kind="error" title={run.error.problem.title} action={run.error.retryable ? { label: 'Try again', run: onRetry } : undefined}>
          {run.error.problem.detail}
        </CardState>
        <div className="button-row">
          <button type="button" className="button button--on-deep" onClick={() => onChooseHorizon('week')}>
            See next 7 days
          </button>
          <button type="button" className="button button--on-deep" onClick={() => onChooseHorizon('month')}>
            See next month
          </button>
        </div>
      </AnswerCard>
    );
  }
  if (run.status !== 'done') {
    return (
      <AnswerCard className="narrow" pill={pill} headline="Working it out" smallHeadline>
        <p className="marked" role="status">
          <span className="spinner" aria-hidden="true" />
          Processing on the Field…
        </p>
        <div className="button-row">
          <a className="button button--on-deep" href="/results">
            See the progress
          </a>
          <button type="button" className="button button--on-deep" onClick={() => onChooseHorizon('week')}>
            See next 7 days
          </button>
          <button type="button" className="button button--on-deep" onClick={() => onChooseHorizon('month')}>
            See next month
          </button>
        </div>
      </AnswerCard>
    );
  }
  const best = bestOf(run.analysis);
  return (
    <AnswerCard className="narrow" pill={pill} headline={best ? shortName(best) : 'No clear best'} smallHeadline>
      <ol className="ranked">
        {byRank(run.analysis).map((rotation, index) => (
          <li key={rotation.id} className={index === 0 ? 'ranked__best' : undefined}>
            <p className="ranked__top">
              <span>
                {index + 1}. {shortName(rotation)}
              </span>
              <span className="ranked__score">
                {rotation.overall.value === null ? (
                  'Not scored'
                ) : (
                  <>
                    <strong className="ranked__value number">{Math.round(rotation.overall.value)}</strong> out of 100
                  </>
                )}
              </span>
            </p>
            {rotation.role === 'current' && <p className="secondary">What you grow now.</p>}
          </li>
        ))}
      </ol>
      {run.analysis.ranking_note && <p className="secondary">{run.analysis.ranking_note}</p>}
      <HorizonActions horizon="year" onChooseHorizon={onChooseHorizon} />
    </AnswerCard>
  );
}

function sourceLine(briefing: FieldBriefing, analysis: Analysis | null): string {
  const parts: string[] = [];
  const moistureSource = briefing.soilRootZone.available
    ? { source: briefing.soilRootZone.source, date: briefing.soilRootZone.readOn }
    : briefing.soilSurface.available
      ? { source: briefing.soilSurface.source, date: briefing.soilSurface.readOn }
      : briefing.recentRain.available && briefing.recentRain.readThrough
        ? { source: briefing.recentRain.source, date: briefing.recentRain.readThrough }
        : null;
  if (moistureSource) parts.push(`Rain and soil moisture: ${moistureSource.source}, latest reading ${formatDay(moistureSource.date)}.`);
  if (briefing.forecast.available) parts.push(`Forecast: ${briefing.forecast.provider}${briefing.forecast.issuedAt ? `, fetched ${formatDay(briefing.forecast.issuedAt.slice(0, 10))}` : ''}.`);
  if (briefing.yearClimate.available && briefing.yearClimate.source) {
    parts.push(`Usual month and year: ${briefing.yearClimate.source}${briefing.yearClimate.recordYears ? `, ${briefing.yearClimate.recordYears}` : ''}.`);
  }
  if (analysis) parts.push(`Rotation scores from ${coveredCount(analysis.datasets)} of our ${analysis.datasets.length} data sources.`);
  return parts.join(' ');
}

interface HomeScreenProps {
  client: ApiClient;
  plan: AnalysisPlan;
  run: RunState;
  onRetry: () => void;
}

/** Shown on the overview dashboard when no field is set up yet or after a field is removed. */
export function EmptyHomeScreen({ onOpenSetup, onOpenExample }: { onOpenSetup: () => void; onOpenExample: (example: ExampleField) => void }) {
  const [horizon, setHorizon] = useState<Horizon>(storedHorizon);
  const [openedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const today = longDate(openedOn);

  const chooseHorizon = (next: Horizon) => {
    setHorizon(next);
    try {
      window.localStorage.setItem(HORIZON_KEY, next);
    } catch {
      // Storage can be blocked.
    }
  };

  return (
    <>
      <div className="home-top">
      <header className="page-head">
        <p className="home-place">No field selected</p>
        <p className="secondary">{today}</p>
        <h1 className="page-title">Today on your field</h1>
        <p className="lead">
          No field is set up yet. Mark your field on the map to see live weather, recent rain, soil wetness, and rotation advice for your land.
        </p>
      </header>
      {/* Real US farms from the USDA crop map, compared live like any other field. */}
      <div className="samples" role="group" aria-labelledby="samples-label">
        <span id="samples-label" className="samples__label">
          Sample
        </span>
        <div className="samples__row">
          {EXAMPLE_FIELDS.map((example) => (
            <button key={example.id} type="button" className="field-pill sample-pill" title={example.story} onClick={() => onOpenExample(example)}>
              <CropIllustration cropId={example.cropId} size="chip" />
              <span className="field-pill__name">{example.short}</span>
              <span className="visually-hidden">: {example.place}, {example.story}</span>
            </button>
          ))}
        </div>
      </div>
      </div>

      <div className="reading-grid">
        <Card title="Weather today" smallTitle aside={<Pill tone="neutral">No field</Pill>}>
          <CardState kind="empty" title="No weather measure yet." action={{ label: 'Set up your field', run: onOpenSetup }}>
          </CardState>
        </Card>
        <Card title="Rain" smallTitle aside={<Pill tone="neutral">No field</Pill>}>
          <CardState kind="empty" title="No rain readings yet">
          </CardState>
        </Card>
        <Card title="Soil moisture" smallTitle aside={<Pill tone="neutral">No field</Pill>}>
          <CardState kind="empty" title="No soil readings yet">
          </CardState>
        </Card>
      </div>

      <section className="section-head" aria-labelledby="what-to-grow">
        <div className="section-head__title">
          <h2 id="what-to-grow" className="card__title">
            What to grow, and when
          </h2>
        </div>
        <ToggleGroup label="How far ahead" options={HORIZONS} value={horizon} onChange={chooseHorizon} />
      </section>

      <div className="row row--split">
        <div className="wide home-stack">
          <Card title={horizon === 'week' ? 'The week ahead' : horizon === 'month' ? 'Next month on your field' : 'A usual year on your field'}>
            <CardState kind="empty" title="No field selected yet">
              Set up your field to see weather patterns and water needs for this period.
            </CardState>
          </Card>
          <Card title="Suggested crops for your field" aside={<Pill tone="neutral">No field</Pill>}>
            <CardState kind="empty" title="No crop suggestions yet" action={{ label: 'Set up your field', run: onOpenSetup }}>
              We screen regional crops against your frost-free season, water supply, and equipment once a field is set.
            </CardState>
          </Card>
        </div>
        <AnswerCard
          className="narrow"
          pill={horizon === 'week' ? 'Sowing this week' : horizon === 'month' ? 'Planting this month' : 'Rotation for the year'}
          headline="No field set up yet"
          smallHeadline
        >
          <p>Tell us where your field is, what water and machines you have, and what matters most to you.</p>
          <div className="button-row">
            <button type="button" className="button button--amber" onClick={onOpenSetup}>
              Set up your field
            </button>
          </div>
        </AnswerCard>
      </div>

      <Reminder />
    </>
  );
}

/** The screen a farmer lands on: what is happening on the field today, then what to grow and when. */
export function HomeScreen({ client, plan, run, onRetry }: HomeScreenProps) {
  const [lon, lat] = centroid(plan.field.geometry);
  const [briefingState, retryBriefing] = useBriefing(client, lat, lon);
  const [horizon, setHorizon] = useState<Horizon>(storedHorizon);
  const [openedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const { crops } = useAnalysisScope();
  const analysis = run.status === 'done' ? run.analysis : null;
  const briefing = useMemo(() => buildBriefing(briefingState, analysis), [briefingState, analysis]);
  const best = analysis ? bestOf(analysis) : null;
  const lastVisit = useLastVisit(`${lat.toFixed(4)},${lon.toFixed(4)}`, best ? shortName(best) : null);

  const chooseHorizon = (next: Horizon) => {
    setHorizon(next);
    try {
      window.localStorage.setItem(HORIZON_KEY, next);
    } catch {
      // Storage can be blocked. The choice still holds for this visit.
    }
  };

  const forecast = briefing.forecast;
  const days = forecast.available ? forecast.days.slice(0, WEEK_DAYS) : null;
  const forecastProps = {
    days,
    loading: briefingState.status === 'loading',
    why: forecast.available ? '' : forecast.why,
    onRetry: briefingState.status === 'failed' ? retryBriefing : null,
  };
  const waiting = run.status === 'running' || run.status === 'idle';
  const ground = groundOf(briefing.soilSurface, briefing.soilRootZone);
  const soilLoading = briefingState.status === 'loading' || (waiting && !briefing.soilRootZone.available && !briefing.soilSurface.available);
  const yearLoading = briefingState.status === 'loading' || (waiting && !briefing.yearClimate.available);
  const scenarioIsNormal = plan.scenario.rainfall === 'normal' && plan.scenario.temperature === 'normal';
  const changed = best !== null && lastVisit !== null && lastVisit.best !== shortName(best);
  const today = longDate(days ? days[0].date : openedOn);
  const cityCountry = useResolvedPlace(lat, lon, null, true, '');
  const customName = cleanPlaceName(plan.field.name);
  const placeName = customName ?? (cityCountry || 'Your field');
  const sources = sourceLine(briefing, analysis);

  return (
    <>
      <header className="page-head">
        <p className="home-place">{placeName}</p>
        <p className="secondary">{today}</p>
        <h1 className="page-title">Today on your field</h1>
        <p className="lead">{summaryOf(briefing)}</p>
      </header>

      {changed && (
        <p className="strip strip--care" role="status">
          The advice has changed since your last visit on {formatDay(lastVisit.seenOn)}. The best rotation was {lastVisit.best.toLowerCase()}. It is now {shortName(best).toLowerCase()}.
        </p>
      )}

      <div className="reading-grid">
        <WeatherCard {...forecastProps} ground={ground} />
        <RainCard rain={briefing.recentRain} />
        <SoilCard surface={briefing.soilSurface} rootZone={briefing.soilRootZone} loading={soilLoading} />
      </div>

      <section className="section-head" aria-labelledby="what-to-grow">
        <div className="section-head__title">
          <h2 id="what-to-grow" className="card__title">
            What to grow, and when
          </h2>
          <p className="secondary">Pick how far ahead you want to look.</p>
        </div>
        <ToggleGroup label="How far ahead" options={HORIZONS} value={horizon} onChange={chooseHorizon} />
      </section>

      <div className="row row--split">
        {horizon === 'week' && (
          <>
            <div className="wide home-stack">
              <WeekOutlook {...forecastProps} waterLossMm={briefing.weekWater.available ? briefing.weekWater.lossMm : null} />
              <SuggestedCropsCard
                horizon="week"
                crops={crops}
                analysis={analysis}
                briefing={briefing}
                water={plan.farm.water}
                equipment={plan.farm.equipment}
                priorities={plan.farm.priorities}
                requireForage={plan.farm.requireForage}
                localMarketOnly={plan.farm.localMarketOnly}
                scenario={plan.scenario}
                loading={waiting}
              />
            </div>
            <AdviceCard pill="Best to sow this week" horizon="week" advice={briefing.sowThisWeek} actionLead="Do this first:" onChooseHorizon={chooseHorizon} />
          </>
        )}
        {horizon === 'month' && (
          <>
            <div className="wide home-stack">
              <MonthOutlookCard outlook={briefing.monthOutlook} loading={briefingState.status === 'loading'} />
              <SuggestedCropsCard
                horizon="month"
                crops={crops}
                analysis={analysis}
                briefing={briefing}
                water={plan.farm.water}
                equipment={plan.farm.equipment}
                priorities={plan.farm.priorities}
                requireForage={plan.farm.requireForage}
                localMarketOnly={plan.farm.localMarketOnly}
                scenario={plan.scenario}
                loading={waiting}
              />
            </div>
            <AdviceCard pill="Best to plant this month" horizon="month" advice={briefing.plantThisMonth} actionLead="Plan for this:" onChooseHorizon={chooseHorizon} />
          </>
        )}
        {horizon === 'year' && (
          <>
            <div className="wide home-stack">
              <YearOutlook climate={briefing.yearClimate} loading={yearLoading} />
              <SuggestedCropsCard
                horizon="year"
                crops={crops}
                analysis={analysis}
                briefing={briefing}
                water={plan.farm.water}
                equipment={plan.farm.equipment}
                priorities={plan.farm.priorities}
                requireForage={plan.farm.requireForage}
                localMarketOnly={plan.farm.localMarketOnly}
                scenario={plan.scenario}
                loading={waiting}
              />
            </div>
            <YearAnswer run={run} onRetry={onRetry} onChooseHorizon={chooseHorizon} />
          </>
        )}
      </div>
      {horizon === 'year' && !scenarioIsNormal && (
        <p className="caption">
          The rotation scores are for a year with {RAIN_WORDS[plan.scenario.rainfall].toLowerCase()} rain and {HEAT_WORDS[plan.scenario.temperature].toLowerCase()} heat. You can change that in the full comparison.
        </p>
      )}

      <div className="strip">
        <span className="strip__icon">
          <BellIcon />
        </span>
        <p className="strip__body">
          <strong>We check your field every day.</strong> When the weather or the soil changes the advice, this page changes with it. You don’t have to ask again.
          {lastVisit && !changed && best && ` The best rotation is the same as on your last visit, on ${formatDay(lastVisit.seenOn)}.`}
        </p>
      </div>

      {sources && <p className="caption">{sources}</p>}
      <Reminder />
    </>
  );
}
