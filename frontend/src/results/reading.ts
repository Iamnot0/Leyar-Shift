import type { Analysis, Currency, Rotation, Score, ScoreId, Tradeoff } from '../api/types';
import { formatWhole, lowerFirst, sentenceCase } from '../lib/format';

/** How far a score must move, out of 100, before "better" becomes "much better". */
const MUCH_FROM = 30;

/** A rotation's name without the bracketed crop notes: "Pulses, then sorghum". */
export const shortName = (rotation: Rotation) => sentenceCase(rotation.label.replace(/ \([^)]*\)/g, ''));
export const nameInSentence = (rotation: Rotation) => lowerFirst(shortName(rotation));

export const currentOf = (analysis: Analysis) => analysis.rotations.find((rotation) => rotation.role === 'current') ?? analysis.rotations[0];

/** Best first. A rotation that could not be ranked goes last. */
export const byRank = (analysis: Analysis) => [...analysis.rotations].sort((a, b) => (a.overall.rank ?? Infinity) - (b.overall.rank ?? Infinity));

export const bestOf = (analysis: Analysis): Rotation | null => byRank(analysis).find((rotation) => rotation.overall.rank === 1) ?? null;

/** The alternative to set against what is grown now: the best-ranked one. */
export const alternativesOf = (analysis: Analysis) => byRank(analysis).filter((rotation) => rotation.role !== 'current');

export const scoreOf = (rotation: Rotation, id: ScoreId): Score | undefined => rotation.scores.find((score) => score.id === id);

export function physicalWords(score: Score | undefined, currency?: Currency | null): string | null {
  return score?.physical && score.physical.value !== null ? formatWhole(score.physical.value, score.physical.unit, currency) : null;
}

/** How often a rotation came out best, said in weather years. */
export function cameOutBest(rotation: Rotation): string | null {
  const { share_ranked_first: share, n_runs: years } = rotation.overall.rank_stability;
  if (share === null) return null;
  const wins = Math.round(share * years);
  if (wins === years) return `Came out best in all ${years} weather years.`;
  if (wins === 0) return `Did not come out best in any of the ${years} weather years.`;
  return `Came out best in ${wins} of ${years} weather years.`;
}

export interface Verdict {
  word: string;
  direction: 'better' | 'worse' | 'level' | 'unknown';
}

export function verdictOf(tradeoff: Tradeoff): Verdict {
  const much = Math.abs(tradeoff.score_delta ?? 0) >= MUCH_FROM;
  switch (tradeoff.direction) {
    case 'better':
      return { word: much ? 'Much better' : 'Better', direction: 'better' };
    case 'worse':
      return { word: much ? 'Much worse' : 'Worse', direction: 'worse' };
    case 'similar':
      return { word: 'About the same', direction: 'level' };
    case 'uncertain':
      return { word: 'Too close to call', direction: 'level' };
    default:
      return { word: 'Can’t compare yet', direction: 'unknown' };
  }
}

/** The farmer's own priorities lead: the measure with the most weight comes first. */
export function byWeight(option: Rotation): Tradeoff[] {
  const weight = (tradeoff: Tradeoff) => scoreOf(option, tradeoff.score_id)?.weight ?? 0;
  return [...option.tradeoffs].sort((a, b) => weight(b) - weight(a));
}

const GAIN_WORDS: Record<ScoreId, string> = {
  water_balance: 'It needed less water',
  soil_health: 'It was better for soil health',
  erosion: 'It left less soil to wash away',
  climate_risk: 'It ran less risk from bad weather',
  pest_break: 'It did more to break pest cycles',
  economics: 'It earned more',
};

/** One closing line for a switch: the gain that matters most to the farmer, and how often it held. */
export function switchClosing(option: Rotation, weatherYears: number): string {
  const gain = byWeight(option).find((tradeoff) => tradeoff.direction === 'better' && tradeoff.share_of_runs_better !== null);
  if (!gain || gain.share_of_runs_better === null) return 'It did not come out clearly better on any measure.';
  const wins = Math.round(gain.share_of_runs_better * weatherYears);
  return wins === weatherYears ? `${GAIN_WORDS[gain.score_id]} in every one of the ${weatherYears} weather years we tried.` : `${GAIN_WORDS[gain.score_id]} in ${wins} of the ${weatherYears} weather years we tried.`;
}

/** Why the best fit was put forward, in words. The figures are in the table beneath it. */
export function reasonSentence(best: Rotation, current: Rotation): string {
  if (best.id === current.id) return 'What you grow now already fits what matters to you better than the other rotations we compared.';
  return best.why_suggested[0]?.text ?? '';
}

const DOUBT_WORDS: Record<string, string> = {
  weather_variability: 'the weather changing from year to year',
  soil_properties: 'how much water your soil can hold',
  crop_parameters: 'when crops are sown and how they grow',
  rainfall_source_disagreement: 'rainfall records that do not agree',
};

export function doubtSentence(analysis: Analysis): string {
  const main = [...analysis.uncertainty.drivers].filter((driver) => driver.share !== null).sort((a, b) => (b.share ?? 0) - (a.share ?? 0))[0];
  if (!main || main.share === null || !DOUBT_WORDS[main.id]) return 'We can’t be exact. The box on each bar shows how far the score could move.';
  const amount = main.share >= 0.9 ? 'Nearly all' : main.share >= 0.6 ? 'Most' : 'The largest part';
  return `We can’t be exact. ${amount} of the doubt (${Math.round(main.share * 100)}%) comes from ${DOUBT_WORDS[main.id]}.`;
}
