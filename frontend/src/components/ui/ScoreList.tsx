import type { Rotation, Score } from '../../api/types';
import { COMPOSITE_NOTE, SCORE_WORDS } from '../../content/copy';
import { OwnFiguresControl } from '../../results/OwnFiguresControl';
import { MissingValue, QuantityView } from './Values';

/** How a score reads: its physical quantity where one exists, and only then the index out of 100. */
export function ScoreValue({ score }: { score: Score }) {
  if (score.value === null) {
    return <MissingValue reason={score.null_reason ?? 'not_configured'} explanation={score.null_explanation} retryable={score.retryable} />;
  }
  const index = (
    <span className="figure__range">
      Scores {Math.round(score.value)} out of 100{score.low !== null && score.high !== null && Math.round(score.low) !== Math.round(score.high) ? `, usually between ${Math.round(score.low)} and ${Math.round(score.high)}` : ''}
    </span>
  );
  if (score.physical && score.physical.value !== null) {
    return (
      <>
        <QuantityView quantity={score.physical} />
        <p className="note">{index}</p>
      </>
    );
  }
  return (
    <>
      <div className="figure">
        <span className="figure__value">{Math.round(score.value)} out of 100</span>
        {score.low !== null && score.high !== null && Math.round(score.low) !== Math.round(score.high) && (
          <span className="figure__range">
            usually between {Math.round(score.low)} and {Math.round(score.high)}
          </span>
        )}
      </div>
      {score.components.length > 0 && (
        <ul className="plain-list score-parts">
          {score.components.map((component) => (
            <li key={component.id}>
              <QuantityView quantity={component.quantity} lead={<span className="figure__label">{component.label}:</span>} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Every score for one rotation: plain label, what it means, the value with its range and its evidence. */
export function ScoreList({ scores, rotation }: { scores: Score[]; rotation?: Rotation }) {
  return (
    <dl className="measures">
      {scores.map((score) => (
        <div key={score.id} className="measures__row">
          <dt>
            <span className="measures__label">{SCORE_WORDS[score.id]}</span>
            <span className="measures__explain">
              {score.physical_label && `${score.physical_label}. `}
              {score.explanation}
              {score.composite && ` ${COMPOSITE_NOTE}`}
            </span>
          </dt>
          <dd>
            <ScoreValue score={score} />
            {score.id === 'economics' && rotation && <OwnFiguresControl rotations={[rotation]} />}
          </dd>
        </div>
      ))}
    </dl>
  );
}
