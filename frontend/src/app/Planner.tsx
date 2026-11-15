import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { runAnalysis, toApiError, type ApiClient, type ApiError } from '../api/client';
import { useResolvedPlace } from '../api/places';
import type { Analysis, AnalysisRequest, ContextLayer, Polygon, RotationYear, Scenario } from '../api/types';
import { SHARPEST, picturesFrom, type PictureChoice } from '../components/map/imagery';
import { HEAT_WORDS, RAIN_WORDS } from '../content/copy';
import type { ExampleField } from '../content/examples';
import { formatHectares } from '../lib/format';
import { areaHa, centroid } from '../lib/geo';
import { EmptyHomeScreen, HomeScreen } from '../home/HomeScreen';
import { EmptyResultsScreen, ResultsScreen } from '../results/ResultsScreen';
import type { CropsState, HistoryState, RotationAnswer } from '../setup/RotationQuestion';
import { SetupScreen } from '../setup/SetupScreen';
import { Header } from '../shell/Header';
import type { ThemeName } from '../styles/tokens.generated';
import { AnalysisContext } from './context';
import type { AnalysisPlan, CoverageState, FarmDraft, FieldPlan, RunState } from './plan';
import { useRoute } from './route';
import { forgetField, loadSavedPlan, savePlan } from './saved';

const NORMAL: Scenario = { rainfall: 'normal', temperature: 'normal' };
// Equipment starts unanswered (null), which filters nothing. An empty list would say the farmer has no machines at all.
const EMPTY_FARM: FarmDraft = { water: null, equipment: null, priorities: [], requireForage: false, localMarketOnly: false, ownFigures: [] };
const RECHECK_MS = 6 * 60 * 60 * 1000;

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

function requestFor(plan: AnalysisPlan): AnalysisRequest | null {
  if (plan.farm.water === null) return null;
  return {
    field: { name: plan.field.name, geometry: plan.field.geometry },
    farmer: {
      water_availability: plan.farm.water,
      equipment: plan.farm.equipment,
      priorities: plan.farm.priorities,
      require_forage: plan.farm.requireForage,
      local_market_only: plan.farm.localMarketOnly,
      own_figures: plan.farm.ownFigures ?? [],
      current_rotation: plan.years ? { years: plan.years } : null,
      current_rotation_confirmed: plan.confirmed,
    },
    scenario: plan.scenario,
  };
}

interface PlannerProps {
  client: ApiClient;
  theme: ThemeName;
  /** Notes about the connection to the data service, shown under the header. */
  notices: ReactNode;
  onThemeChange: (theme: ThemeName) => void;
}

/** The app once it is connected: the header, and whichever screen the address names. */
export function Planner({ client, theme, notices, onThemeChange }: PlannerProps) {
  const [saved] = useState(loadSavedPlan);
  const [route, navigate] = useRoute();
  /** The plan the results on screen were asked with. Null until setup has been finished once. */
  const [plan, setPlan] = useState<AnalysisPlan | null>(saved ? { ...saved, scenario: NORMAL } : null);
  const [field, setField] = useState<FieldPlan | null>(saved?.field ?? null);
  const [coverage, setCoverage] = useState<CoverageState>(saved ? { status: 'checking' } : { status: 'idle' });
  const [history, setHistory] = useState<HistoryState>({ status: 'idle' });
  const [farm, setFarm] = useState<FarmDraft>(saved?.farm ?? EMPTY_FARM);
  const [rotationYears, setRotationYears] = useState<RotationYear[] | null>(saved?.years ?? null);
  const [rotationConfirmed, setRotationConfirmed] = useState(saved?.confirmed ?? false);
  const [crops, setCrops] = useState<CropsState>({ status: 'loading' });
  const [contextLayers, setContextLayers] = useState<ContextLayer[]>([]);
  const [pictureChoice, setPictureChoice] = useState<PictureChoice>(SHARPEST);
  const pictures = useMemo(() => picturesFrom(contextLayers), [contextLayers]);
  const [run, setRun] = useState<RunState>(saved ? { status: 'running', stage: null } : { status: 'idle' });
  const [reachable, setReachable] = useState(true);
  const [weatherYears, setWeatherYears] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const activeRun = useRef<AbortController | null>(null);
  const cache = useRef(new Map<string, Analysis>());

  const noteFailure = useCallback((error: ApiError) => {
    if (error.problem.type === 'network') setReachable(false);
  }, []);

  // The backend's context layers depend on the place: which pictures exist there, and the dates they default to.
  const loadLayers = useCallback(
    (lat: number, lon: number) => {
      client
        .listLayers(lat, lon)
        .then((list) => setContextLayers(list.layers))
        .catch(() => setContextLayers([]));
    },
    [client],
  );

  const loadCrops = useCallback(
    (geometry: Polygon) => {
      const [lon, lat] = centroid(geometry);
      setCrops({ status: 'loading' });
      client
        .listCrops(lat, lon)
        .then((list) => setCrops({ status: 'ready', crops: list.crops }))
        .catch((error: unknown) => setCrops({ status: 'failed', error: toApiError(error) }));
    },
    [client],
  );

  const loadHistory = useCallback(
    (geometry: Polygon) => {
      setHistory({ status: 'loading' });
      client
        .getCropHistory(geometry)
        .then((result) => setHistory({ status: 'ready', history: result }))
        .catch((error: unknown) => setHistory({ status: 'failed', error: toApiError(error) }));
    },
    [client],
  );

  const finish = useCallback((analysis: Analysis) => {
    setRun({ status: 'done', analysis });
    setWeatherYears(analysis.uncertainty.n_runs);
    setReachable(true);
  }, []);

  /**
   * Asks the backend for a comparison and follows it to its end. The caller has already shown it as running.
   * A quiet launch is a routine re-check: the results on screen stay until newer ones arrive, and stay if none do.
   */
  const launch = useCallback(
    (next: AnalysisPlan, quiet = false) => {
      const request = requestFor(next);
      if (!request) return;
      activeRun.current?.abort();
      const controller = new AbortController();
      activeRun.current = controller;
      runAnalysis(client, request, (stage) => quiet || setRun({ status: 'running', stage }), controller.signal)
        .then((analysis) => {
          cache.current.set(JSON.stringify(request), analysis);
          finish(analysis);
        })
        .catch((error: unknown) => {
          if (isAbort(error)) return;
          const failure = toApiError(error);
          noteFailure(failure);
          if (!quiet) setRun({ status: 'failed', error: failure });
        });
    },
    [client, finish, noteFailure],
  );

  const startAnalysis = (next: AnalysisPlan) => {
    const request = requestFor(next);
    if (!request) return;
    const cached = cache.current.get(JSON.stringify(request));
    if (cached) {
      activeRun.current?.abort();
      return finish(cached);
    }
    setRun({ status: 'running', stage: null });
    launch(next);
  };

  /** Asks what covers a field, then loads what the questions about it need. */
  const fetchCoverage = useCallback(
    (next: FieldPlan) => {
      client
        .checkCoverage(next.geometry)
        .then((result) => {
          setCoverage({ status: 'ready', coverage: result });
          loadCrops(next.geometry);
          loadLayers(result.field.centroid.lat, result.field.centroid.lon);
          if (result.crop_history_available) loadHistory(next.geometry);
        })
        .catch((error: unknown) => {
          const failure = toApiError(error);
          noteFailure(failure);
          setCoverage({ status: 'failed', error: failure });
        });
    },
    [client, loadCrops, loadHistory, loadLayers, noteFailure],
  );

  /** Each removal starts setup afresh, even when it is already open at the first step. */
  const [setupRound, setSetupRound] = useState(0);
  const removeField = () => {
    activeRun.current?.abort();
    forgetField();
    cache.current.clear();
    setPlan(null);
    setField(null);
    setCoverage({ status: 'idle' });
    setHistory({ status: 'idle' });
    setCrops({ status: 'loading' });
    setFarm(EMPTY_FARM);
    setRotationYears(null);
    setRotationConfirmed(false);
    setRun({ status: 'idle' });
    setSetupRound((round) => round + 1);
    setAnnouncement('Your field is removed. Mark a new field to start again.');
    navigate({ screen: 'home' });
  };

  // An example is a real field with its answers filled in: it runs the same live comparison as any other.
  const openExample = (example: ExampleField) => {
    activeRun.current?.abort();
    const next: AnalysisPlan = { ...example.plan, scenario: NORMAL };
    setField(next.field);
    setFarm(next.farm);
    setRotationYears(next.years);
    setRotationConfirmed(next.confirmed);
    setCoverage({ status: 'checking' });
    setHistory({ status: 'idle' });
    fetchCoverage(next.field);
    setPlan(next);
    savePlan(next);
    startAnalysis(next);
    navigate({ screen: 'results' });
  };

  const checkField = (next: FieldPlan) => {
    setField(next);
    setFarm((current) => (current.ownFigures?.length ? { ...current, ownFigures: [] } : current));
    setCoverage({ status: 'checking' });
    setHistory({ status: 'idle' });
    // Crops differ by place, so a rotation never carries over from one field to another.
    setRotationYears(null);
    setRotationConfirmed(false);
    fetchCoverage(next);
  };

  // A returning farmer's field is checked and compared again on arrival, without being asked.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !saved) return;
    started.current = true;
    fetchCoverage(saved.field);
    launch({ ...saved, scenario: NORMAL });
  }, [saved, fetchCoverage, launch]);
  useEffect(() => () => activeRun.current?.abort(), []);

  // The advice is checked again through the day while the page stays open, as the home screen promises.
  const settled = run.status === 'done';
  useEffect(() => {
    if (!plan || !settled) return;
    const timer = window.setInterval(() => launch(plan, true), RECHECK_MS);
    return () => window.clearInterval(timer);
  }, [plan, settled, launch]);

  // The overview dashboard (home) is the default screen.
  const screen = route.screen;
  const setupStep = route.screen === 'setup' ? route.step : 0;
  const shownScreen = useRef(screen);

  // Moving between screens is a page change: take focus and the scroll position with it.
  useEffect(() => {
    if (shownScreen.current === screen) return;
    shownScreen.current = screen;
    // Instant, not the page's smooth scroll: a slow scroll stops part-way while the new screen loads.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    document.getElementById('content')?.focus({ preventScroll: true });
  }, [screen]);

  const runWith = (change: Partial<AnalysisPlan>) => {
    const base: AnalysisPlan | null = plan ?? (field ? { field, farm, years: rotationYears, confirmed: rotationConfirmed, scenario: NORMAL } : null);
    if (!base) return;
    const next = { ...base, ...change };
    setPlan(next);
    setField(next.field);
    setFarm(next.farm);
    setRotationYears(next.years);
    setRotationConfirmed(next.confirmed);
    savePlan(next);
    startAnalysis(next);
  };

  const compare = (fieldName: string | null, draft: FarmDraft, rotation: RotationAnswer) => {
    if (!field) return;
    runWith({ field: { ...field, name: fieldName }, farm: draft, years: rotation.years, confirmed: rotation.confirmed, scenario: NORMAL });
    navigate({ screen: 'results' });
  };

  const changeScenario = (next: Scenario) => {
    runWith({ scenario: next });
    setAnnouncement(`Results updated for a year with ${RAIN_WORDS[next.rainfall].toLowerCase()} rain and ${HEAT_WORDS[next.temperature].toLowerCase()} heat.`);
  };

  const analysis = run.status === 'done' ? run.analysis : null;
  const scope = {
    datasets: analysis?.datasets ?? [],
    crops: crops.status === 'ready' ? crops.crops : [],
    currency: analysis?.currency ?? null,
    ownFigures: plan?.farm.ownFigures ?? [],
    setOwnFigures: (ownFigures: NonNullable<FarmDraft['ownFigures']>) => {
      if (!plan) return;
      runWith({ farm: { ...plan.farm, ownFigures } });
      setAnnouncement('Results updated with your yield and price.');
    },
    retry: () => runWith({}),
  };
  const picture = { pictures, pictureChoice, theme, onPictureChange: setPictureChoice };
  const shownField = plan?.field ?? null;
  const [headerLon, headerLat] = shownField ? centroid(shownField.geometry) : [0, 0];
  const resolvedHeaderName = useResolvedPlace(headerLat, headerLon, shownField?.name ?? null, Boolean(shownField));
  const headerField = shownField && { name: resolvedHeaderName, areaHa: formatHectares(areaHa(shownField.geometry)) };

  return (
    <AnalysisContext value={scope}>
      <Header live={reachable} theme={theme} onThemeChange={onThemeChange} screen={screen === 'setup' ? null : screen} field={headerField} onChangeField={() => navigate({ screen: 'setup', step: 0 })} />
      <main id="content" className="page" tabIndex={-1}>
        {notices}
        {screen === 'setup' ? (
          <SetupScreen
            key={`${setupRound}-${setupStep}`}
            initialStep={setupStep}
            {...picture}
            field={field}
            coverage={coverage}
            history={history}
            crops={crops}
            farm={farm}
            onFarmChange={setFarm}
            rotationYears={rotationYears}
            rotationConfirmed={rotationConfirmed}
            canLeave={plan !== null}
            onRemoveField={removeField}
            onCheckField={checkField}
            onRetryCrops={() => field && loadCrops(field.geometry)}
            onRetryHistory={() => field && loadHistory(field.geometry)}
            onCompare={compare}
          />
        ) : screen === 'home' ? (
          plan ? (
            <HomeScreen key={JSON.stringify(plan.field.geometry)} client={client} plan={plan} run={run} onRetry={() => runWith({})} />
          ) : (
            <EmptyHomeScreen onOpenSetup={() => navigate({ screen: 'setup', step: 0 })} onOpenExample={openExample} />
          )
        ) : plan ? (
          <ResultsScreen
            field={plan.field}
            run={run}
            coverage={coverage}
            scenario={plan.scenario}
            rotationConfirmed={plan.confirmed}
            weatherYears={weatherYears}
            {...picture}
            onScenarioChange={changeScenario}
            onOpenSetup={(step) => navigate({ screen: 'setup', step })}
            onConfirmRotation={() => runWith({ confirmed: true })}
            onRetry={() => runWith({})}
          />
        ) : (
          <EmptyResultsScreen onOpenSetup={() => navigate({ screen: 'setup', step: 0 })} />
        )}
      </main>
      <p className="visually-hidden" role="status">
        {announcement}
      </p>
    </AnalysisContext>
  );
}
