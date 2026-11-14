import type { Analysis, AnalysisRequest, Briefing, Coverage, CropHistory, CropList, FieldGeometry, Job, LayerList, Meta, Outlook, Problem, Reasoning, ZoneLayers } from './types';

export class ApiError extends Error {
  readonly problem: Problem;

  constructor(problem: Problem) {
    super(problem.detail);
    this.name = 'ApiError';
    this.problem = problem;
  }

  /** Worth trying again: the request never arrived, or the server failed. A refusal is not. */
  get retryable(): boolean {
    const { status, type } = this.problem;
    return type === 'network' || (status >= 500 && status !== 501);
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const detail = error instanceof Error ? error.message : 'Something went wrong.';
  return new ApiError({ type: 'internal', title: 'Unexpected error', status: 500, detail });
}

export interface ApiClient {
  getMeta(): Promise<Meta>;
  checkCoverage(geometry: FieldGeometry): Promise<Coverage>;
  /** What the cropland map shows was grown on the field, and the rotation read from it. */
  getCropHistory(geometry: FieldGeometry): Promise<CropHistory>;
  listCrops(lat: number, lon: number): Promise<CropList>;
  listLayers(lat: number, lon: number): Promise<LayerList>;
  /** The ten-day weather forecast at a place. Separate from the analysis, and changes none of its figures. */
  getOutlook(lat: number, lon: number): Promise<Outlook>;
  /** Everything the field screen shows: forecast, recent rain, soil wetness, month and year pattern, and sowing advice when available. */
  getBriefing(lat: number, lon: number): Promise<Briefing>;
  createAnalysis(request: AnalysisRequest): Promise<Job>;
  getAnalysis(analysisId: string): Promise<Job>;
  getZones(analysisId: string): Promise<ZoneLayers>;
  /** The engine's steps behind a finished analysis, each fact naming where in the result it was read. */
  getReasoning(analysisId: string): Promise<Reasoning>;
}

interface CallOptions {
  query?: Record<string, number | string>;
  body?: unknown;
}

const NO_CONNECTION: Problem = { type: 'network', title: 'No connection', status: 0, detail: 'We could not reach the data service. Check your connection, then try again.' };

/** What a proxy in front of the data service answers, without a problem body, when the service itself is down. */
const GATEWAY_FAILURES = [502, 503, 504];

// Five decimals is about a metre: the same field always asks the same question, so the CDN can answer it again.
function place(lat: number, lon: number) {
  return { lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)) };
}

export function createHttpClient(baseUrl: string): ApiClient {
  async function call<T>(method: 'GET' | 'POST', path: string, options: CallOptions = {}): Promise<T> {
    const query = options.query ? `?${new URLSearchParams(Object.entries(options.query).map(([key, value]) => [key, String(value)]))}` : '';
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}${query}`, {
        method,
        headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      throw new ApiError(NO_CONNECTION);
    }
    if (response.ok) return (await response.json()) as T;

    let problem: Problem;
    try {
      problem = (await response.json()) as Problem;
    } catch {
      problem = GATEWAY_FAILURES.includes(response.status)
        ? NO_CONNECTION
        : { type: 'internal', title: 'Something went wrong', status: response.status, detail: 'The data service could not answer this. Try again in a moment.' };
    }
    throw new ApiError(problem);
  }

  return {
    getMeta: () => call('GET', '/v1/meta'),
    checkCoverage: (geometry) => call('POST', '/v1/coverage', { body: { geometry } }),
    getCropHistory: (geometry) => call('POST', '/v1/crop-history', { body: { geometry } }),
    listCrops: (lat, lon) => call('GET', '/v1/crops', { query: place(lat, lon) }),
    listLayers: (lat, lon) => call('GET', '/v1/layers', { query: place(lat, lon) }),
    getOutlook: (lat, lon) => call('GET', '/v1/outlook', { query: place(lat, lon) }),
    getBriefing: (lat, lon) => call('GET', '/v1/briefing', { query: place(lat, lon) }),
    createAnalysis: (request) => call('POST', '/v1/analyses', { body: request }),
    getAnalysis: (analysisId) => call('GET', `/v1/analyses/${analysisId}`),
    getZones: (analysisId) => call('GET', `/v1/analyses/${analysisId}/zones`),
    getReasoning: (analysisId) => call('GET', `/v1/analyses/${analysisId}/reasoning`),
  };
}

const POLL_MS = 1000;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('Analysis was superseded', 'AbortError'));
    });
  });
}

/** Starts an analysis and follows the job to its end, reporting the id of each stage the backend names. */
export async function runAnalysis(client: ApiClient, request: AnalysisRequest, onStage: (stage: string | null) => void, signal: AbortSignal): Promise<Analysis> {
  let job = await client.createAnalysis(request);
  while (job.status === 'queued' || job.status === 'running') {
    onStage(job.stage);
    await wait(POLL_MS, signal);
    job = await client.getAnalysis(job.analysis_id);
  }
  if (job.status === 'done' && job.result) return job.result;
  throw new ApiError(job.error ?? { type: 'internal', title: 'No result', status: 500, detail: 'The comparison ended without a result. Try again in a moment.' });
}
