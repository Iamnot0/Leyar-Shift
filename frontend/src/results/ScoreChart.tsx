import { useId, useState, type CSSProperties } from 'react';
import type { Analysis } from '../api/types';
import { SCORE_WORDS } from '../content/copy';
import { cameOutBest, physicalWords, scoreOf, shortName } from './reading';

const GRIDLINES = [0, 25, 50, 75, 100];
const whole = (value: number) => Math.round(value);

/** One bar per rotation, best first: the overall score out of 100, its usual range as a whisker, details on hover, focus or tap. */
export function ScoreChart({ analysis, rotations }: { analysis: Analysis; rotations: Analysis['rotations'] }) {
  const [active, setActive] = useState<string | null>(null);
  const baseId = useId();
  const ranked = rotations.filter((rotation) => rotation.overall.value !== null);
  if (ranked.length === 0) return null;

  return (
    <div className="score-chart">
      <div className="score-chart__plot">
        {GRIDLINES.map((line) => (
          <span key={line} className="score-chart__grid" style={{ '--at': line } as CSSProperties} aria-hidden="true">
            <span className="score-chart__tick">{line}</span>
          </span>
        ))}
        <ol className="score-chart__bars" style={{ '--count': ranked.length } as CSSProperties}>
          {ranked.map((rotation, index) => {
            const { value, low, high, rank } = rotation.overall;
            if (value === null) return null;
            const name = shortName(rotation);
            const hasRange = low !== null && high !== null && whole(low) !== whole(high);
            const usual = hasRange ? `, usually ${whole(low)} to ${whole(high)}` : '';
            const wins = cameOutBest(rotation);
            const income = physicalWords(scoreOf(rotation, 'economics'), analysis.currency);
            const water = physicalWords(scoreOf(rotation, 'water_balance'), analysis.currency);
            const tipId = `${baseId}-${rotation.id}`;
            const open = active === rotation.id;
            const edge = index === 0 ? 'start' : index === ranked.length - 1 ? 'end' : 'middle';
            return (
              <li key={rotation.id} className="score-chart__column" data-best={rank === 1} data-open={open} data-edge={edge}>
                <button
                  type="button"
                  className="score-chart__hit"
                  aria-label={`${name}${rotation.role === 'current' ? ', what you grow now' : ''}: ${whole(value)} out of 100${usual}.`}
                  aria-describedby={open ? tipId : undefined}
                  aria-expanded={open}
                  onClick={() => setActive(open ? null : rotation.id)}
                  onMouseEnter={() => setActive(rotation.id)}
                  onMouseLeave={() => setActive((current) => (current === rotation.id ? null : current))}
                  onFocus={() => setActive(rotation.id)}
                  onBlur={() => setActive((current) => (current === rotation.id ? null : current))}
                  onKeyDown={(event) => event.key === 'Escape' && setActive(null)}
                >
                  <span className="score-chart__bar" style={{ '--value': value } as CSSProperties} />
                  {hasRange && <span className="score-chart__whisker" style={{ '--low': low, '--high': high } as CSSProperties} aria-hidden="true" />}
                  {/* The number sits above whichever is higher, the bar or its range, so the two never overlap. */}
                  <span className="score-chart__value number" style={{ '--top': hasRange ? Math.max(value, high ?? value) : value } as CSSProperties}>
                    {whole(value)}
                  </span>
                </button>
                {open && (
                  <div id={tipId} role="tooltip" className="score-chart__tip">
                    <p className="score-chart__tip-name">{name}</p>
                    <p>
                      {whole(value)} out of 100{usual}
                    </p>
                    {wins && <p>{wins}</p>}
                    {income && (
                      <p>
                        {SCORE_WORDS.economics}: {income}
                      </p>
                    )}
                    {water && (
                      <p>
                        {SCORE_WORDS.water_balance}: {water}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      <ol className="score-chart__names" style={{ '--count': ranked.length } as CSSProperties} aria-hidden="true">
        {ranked.map((rotation) => (
          <li key={rotation.id}>
            <span className="score-chart__name">{shortName(rotation)}</span>
            {rotation.role === 'current' && <span className="score-chart__now">What you grow now</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
