import type { Tradeoff } from '../api/types';

const TENS = 10;

/** The scale that fits the largest difference, rounded up to a ten so the bars can be read against it. */
export function deltaScale(tradeoffs: Tradeoff[]): number {
  const largest = Math.max(0, ...tradeoffs.map((tradeoff) => Math.abs(tradeoff.score_delta ?? 0)));
  return Math.max(TENS, Math.ceil(largest / TENS) * TENS);
}
