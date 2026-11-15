import { useId, useState } from 'react';
import { labelOf, useMeta } from '../app/context';
import type { Analysis, CalendarHazard, CropFit, EvidenceKind, Rotation, ScoreId } from '../api/types';
import { Drawer } from '../components/ui/Drawer';
import { EvidenceTag } from '../components/ui/EvidenceTag';
import { AnswerCard, Card, Pill } from '../components/ui/kit';
import { CropPhotos } from './CropPhotos';
import { RibbonLegend, SeasonRibbon } from '../components/ui/SeasonRibbon';
import { coveredCount } from '../lib/evidence';
import { LocalJudgment, MissingValue, QuantityView } from '../components/ui/Values';
import { CHANGE_LEVEL_WORDS, EVIDENCE_WORDS, RISK_SUBJECT, RISK_WORDS, SCORE_WORDS } from '../content/copy';
import { monthlyRisk } from '../lib/calendar';
import { deltaScale } from '../lib/charts';
import { allFigures, sharedSource, tallyEvidence } from '../lib/evidence';
import { MONTHS, formatValue, joinList, monthSpanWords, numberWord, sentenceCase } from '../lib/format';
import { OwnFiguresControl } from './OwnFiguresControl';
import { ScoreChart } from './ScoreChart';
import { alternativesOf, bestOf, byRank, byWeight, cameOutBest, currentOf, doubtSentence, nameInSentence, physicalWords, reasonSentence, scoreOf, shortName, switchClosing, verdictOf } from './reading';

const whole = (value: number) => Math.round(value);

interface AnswerProps {
  analysis: Analysis;
  comparisonId: string;
  onChangePriorities: () => void;
}

export function BestFitCard({ analysis, comparisonId, onChangePriorities }: AnswerProps) {
  const best = bestOf(analysis);
  const current = currentOf(analysis);
  const showComparison = () => {
    const target = document.getElementById(comparisonId);
    target?.scrollIntoView({ block: 'start' });
    target?.focus({ preventScroll: true });
  };

  if (!best || best.overall.value === null) {
    const nullReason = best?.overall.null_explanation ?? current.overall.null_explanation;
    return (
      <AnswerCard className="wide" pill="Best fit for your field" headline="We could not rank the rotations" smallHeadline>
        <p>
          {nullReason ??
            'Too much of the data for this field is missing to say which rotation fits best. The cards below show what we could work out, and why the rest is missing.'}
        </p>
        {analysis.ranking_note && (
          <p className="ranking-note" role="note">
            {analysis.ranking_note}
          </p>
        )}
        <div className="button-row">
          <button type="button" className="button button--on-deep" onClick={onChangePriorities}>
            Change what matters to you
          </button>
        </div>
      </AnswerCard>
    );
  }

  const switching = best.id !== current.id;
  const rows = headToHead(best, current, analysis.currency);
  const wins = cameOutBest(best);
  return (
    <AnswerCard className="wide" pill={closeCallPill(analysis, current.id)} headline={shortName(best)} media={<CropPhotos rotation={best} />}>
      <p className="lead">{reasonSentence(best, current)}</p>
      {analysis.close_call && (
        <p className="ranking-note" role="note">
          {analysis.close_call.text}
        </p>
      )}
      {analysis.ranking_note && (
        <p className="ranking-note" role="note">
          {analysis.ranking_note}
        </p>
      )}
      {rows.length > 0 && (
        <table className="versus">
          <caption className="visually-hidden">{switching ? `${shortName(best)} against what you grow now, ${nameInSentence(current)}` : `What you grow now, ${nameInSentence(current)}`}</caption>
          <thead>
            <tr>
              <td />
              <th scope="col">What you grow now</th>
              {switching && <th scope="col">{shortName(best)}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">{SCORE_WORDS[row.id]}</th>
                <td>
                  <Figure text={row.now} />
                </td>
                {switching && (
                  <td className="versus__best" data-direction={row.verdict.direction}>
                    <Figure text={row.after} />
                    <span className="versus__verdict">{row.verdict.word}</span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="answer-year">
        <p className="answer-year__title">A year on your field under {switching ? nameInSentence(best) : 'what you grow now'}</p>
        <SeasonRibbon calendar={best.cover_calendar} rotationName={shortName(best)} />
      </div>
      <p className="secondary">
        Fit score: {whole(best.overall.value)} out of 100{switching && current.overall.value !== null ? `, against ${whole(current.overall.value)} for what you grow now` : ''}.{wins && !analysis.close_call ? ` ${wins}` : ''}
      </p>
      <div className="button-row">
        <button type="button" className="button button--amber" onClick={showComparison}>
          See why it fits
        </button>
        <button type="button" className="button button--on-deep" onClick={onChangePriorities}>
          Change what matters to you
        </button>
      </div>
    </AnswerCard>
  );
}

/** The badge: a clear best fit, or how many rotations are level with it. */
function closeCallPill(analysis: Analysis, currentId: string): string {
  const level = analysis.close_call?.rotation_ids;
  if (!level) return 'Best fit for your field';
  if (level.includes(currentId)) return 'About as good as what you grow now';
  return `${sentenceCase(numberWord(level.length))} rotations fit about equally`;
}

/** A figure as a large amount with its unit beneath: "264" over "mm a year". */
function Figure({ text }: { text: string }) {
  const [amount, ...unit] = text.split(' ');
  return (
    <span className="versus__figure">
      <span className="versus__amount number">{amount}</span>
      {unit.length > 0 && <span className="versus__unit">{unit.join(' ')}</span>}
    </span>
  );
}

const HEAD_TO_HEAD_FILL: ScoreId[] = ['water_balance', 'economics', 'climate_risk', 'erosion'];
const HEAD_TO_HEAD_ROWS = 3;

/** The measures the farmer ranked, then the ones that carry a figure, each as now against after. A loss is shown as plainly as a gain. */
function headToHead(best: Rotation, current: Rotation, currency: Analysis['currency']) {
  const ranked = byWeight(best)
    .filter((tradeoff) => (scoreOf(best, tradeoff.score_id)?.weight ?? 0) > 0)
    .map((tradeoff) => tradeoff.score_id);
  return [...new Set([...ranked, ...HEAD_TO_HEAD_FILL])]
    .flatMap((id) => {
      const now = physicalWords(scoreOf(current, id), currency);
      const after = physicalWords(scoreOf(best, id), currency);
      const tradeoff = best.tradeoffs.find((candidate) => candidate.score_id === id);
      return now && after ? [{ id, now, after, verdict: tradeoff ? verdictOf(tradeoff) : ({ word: '', direction: 'unknown' } as const) }] : [];
    })
    .slice(0, HEAD_TO_HEAD_ROWS);
}

const FAILURE_CAUSE_WORDS = { frost: 'frost', heat: 'heat', water: 'drought' } as const;
const FAILURE_CAUSES = Object.keys(FAILURE_CAUSE_WORDS) as (keyof typeof FAILURE_CAUSE_WORDS)[];
const UNCOUNTED_WORDS = {
  frost: 'Frost failures are not counted here.',
  // Watered or flooded crops run cooler than the air the weather grid reports.
  heat: 'Heat failures are counted only for rain-fed crops, since watered and flooded crops stay cooler than the air.',
  water: 'Drought failures are not counted here.',
} as const;

/** "Main limit here: water. Would likely fail in 3 of 25 years: 2 from frost, 1 from drought." */
function limitAndFailure(fit: CropFit, limit: string | null, driestYearsOnly: boolean): string {
  const sentences = limit ? [`Main limit here: ${limit.toLowerCase()}.`] : [];
  const { failure } = fit;
  if (failure) {
    const years = driestYearsOnly ? `the ${failure.years_total} driest years` : `${failure.years_total} years`;
    const causes = FAILURE_CAUSES.filter((cause) => failure.by_cause[cause]);
    if (failure.years_failed === 0) sentences.push(`No failed season in ${years}.`);
    else if (causes.length === 1) sentences.push(`Would likely fail in ${failure.years_failed} of ${years}, from ${FAILURE_CAUSE_WORDS[causes[0]]}.`);
    else sentences.push(`Would likely fail in ${failure.years_failed} of ${years}: ${joinList(causes.map((cause) => `${failure.by_cause[cause]} from ${FAILURE_CAUSE_WORDS[cause]}`))}.`);
    for (const cause of FAILURE_CAUSES) if (failure.by_cause[cause] === null) sentences.push(UNCOUNTED_WORDS[cause]);
  }
  return sentences.join(' ');
}

function RotationDetail({ rotation, onChangeRotation, onConfirmRotation, confirmed, driestYearsOnly }: { rotation: Rotation; onChangeRotation: () => void; onConfirmRotation: () => void; confirmed: boolean; driestYearsOnly: boolean }) {
  const meta = useMeta();
  const isCurrent = rotation.role === 'current';
  const baseline = rotation.baseline;
  const fromMap = isCurrent && baseline !== null && baseline.baseline_source !== 'farmer_supplied';
  const agreed = confirmed || (baseline?.farmer_confirmed ?? false);
  const checks = [...rotation.local_review];
  const fitSource = sharedSource(rotation.crop_fit.flatMap((fit) => fit.checks.map((check) => check.quantity)));
  return (
    <Drawer title={`More about ${nameInSentence(rotation)}`}>
      <div className="detail stack">
        {isCurrent ? (
          <div className="stack stack--tight">
            <p className="secondary">{fromMap ? `We read this from the national cropland map. ${agreed ? 'You told us it is right.' : 'Is this what you grow?'}` : 'This is the rotation you told us you grow.'}</p>
            <div className="button-row">
              {fromMap && !agreed && (
                <button type="button" className="button" onClick={onConfirmRotation}>
                  Yes, this is right
                </button>
              )}
              <button type="button" className="button" onClick={onChangeRotation}>
                Change what you grow
              </button>
            </div>
          </div>
        ) : (
          <p className="secondary">
            {rotation.why_suggested[0]?.text} {CHANGE_LEVEL_WORDS[rotation.change_level]} It has not been grown on your field, so its calendar comes from typical sowing and harvest dates.
          </p>
        )}
        <RibbonLegend />
        <SeasonRibbon calendar={rotation.cover_calendar} rotationName={shortName(rotation)} />
        <QuantityView quantity={rotation.cover_calendar.bare_weeks_per_year} lead={<span className="figure__label">Bare soil:</span>} />
        {rotation.crop_fit.length > 0 && (
          <div className="stack stack--tight">
            <h4>Does your field suit these crops?</h4>
            {fitSource && <EvidenceTag source={fitSource} />}
            {rotation.crop_fit.map((fit) => (
              <section key={fit.crop_id} className="crop-fit">
                <p>
                  <strong>{fit.crop_name}</strong>
                </p>
                {(fit.limiting_check || fit.failure) && <p className="secondary">{limitAndFailure(fit, fit.limiting_check && labelOf(meta.crop_fit_checks, fit.limiting_check), driestYearsOnly)}</p>}
                {/* One cell per check: the verdict and its number. The full sentences stay one tap away. */}
                <ul className="fit-cells">
                  {fit.checks.map((check) => (
                    <li key={check.check} className="fit-cell" data-status={check.status}>
                      <span className="fit-cell__label">{labelOf(meta.crop_fit_checks, check.check)}</span>
                      <span className="fit-cell__status">{labelOf(meta.crop_fit_statuses, check.status)}</span>
                      <span className="fit-cell__value number">
                        {check.quantity.value !== null ? formatValue(check.quantity.value, check.quantity.unit) : 'No figure'}
                      </span>
                    </li>
                  ))}
                </ul>
                <details className="crop-fit__why">
                  <summary>Why, for {fit.crop_name.toLowerCase()}</summary>
                  <ul className="plain-list">
                    {fit.checks.map((check) => (
                      <li key={check.check} className="crop-fit__check">
                        <span>
                          {labelOf(meta.crop_fit_checks, check.check)}: <strong>{labelOf(meta.crop_fit_statuses, check.status)}</strong>
                        </span>
                        <span>{check.text}</span>
                        <QuantityView quantity={check.quantity} evidence={!fitSource} />
                      </li>
                    ))}
                  </ul>
                </details>
              </section>
            ))}
          </div>
        )}
        {(checks.length > 0 || rotation.gaps.length > 0) && (
          <Drawer title="What to check on your own land" count={checks.length + rotation.gaps.length}>
            <ul className="plain-list">
              {checks.map((review) => (
                <LocalJudgment key={review.topic} review={review} />
              ))}
            </ul>
            {rotation.gaps.length > 0 && (
              <ul className="secondary">
                {rotation.gaps.map((gap) => (
                  <li key={gap.id}>{gap.text}</li>
                ))}
              </ul>
            )}
          </Drawer>
        )}
      </div>
    </Drawer>
  );
}

interface ScoresProps {
  analysis: Analysis;
  rotationConfirmed: boolean;
  onConfirmRotation: () => void;
  onChangeRotation: () => void;
}

export function ScoresCard({ analysis, rotationConfirmed, onConfirmRotation, onChangeRotation }: ScoresProps) {
  const rotations = byRank(analysis);
  return (
    <Card className="wide" title="Crop Rotation Score">
      <p className="secondary">Each score is out of 100 for what you told us matters. Higher is better.</p>
      <ScoreChart analysis={analysis} rotations={rotations} />
      <div>
        {rotations.map((rotation) => {
          const { value, low, high, rank } = rotation.overall;
          const best = rank === 1;
          const hasRange = low !== null && high !== null && whole(low) !== whole(high);
          const range = hasRange ? `Usually lands between ${whole(low)} and ${whole(high)}.` : '';
          const name = shortName(rotation);
          const econ = scoreOf(rotation, 'economics');
          const econText = physicalWords(econ, analysis.currency);
          return (
            <section key={rotation.id} className="score-block">
              <div className="score-block__head">
                <h3 className="score-block__name">{name}</h3>
                {best && <Pill tone="amber">Best fit</Pill>}
                {rotation.role === 'current' && <Pill>What you grow now</Pill>}
                {value !== null && (
                  <p>
                    <span className="score-block__score number">{whole(value)}</span> <span className="caption">out of 100</span>
                  </p>
                )}
              </div>
              {value === null ? (
                <MissingValue reason="insufficient_observations" explanation="We could not score this rotation with the data we have for this field." />
              ) : (
                <>
                  <div className="score-track" data-best={best} role="img" aria-label={`${name}: ${whole(value)} out of 100. ${range}`}>
                    <span className="score-track__fill" style={{ inlineSize: `${value}%` }} />
                    {hasRange && <span className="score-track__range" style={{ insetInlineStart: `${low}%`, inlineSize: `${high - low}%` }} />}
                  </div>
                  <p className="secondary">
                    {range} {cameOutBest(rotation)}
                  </p>
                </>
              )}
              <div className="score-income">
                <p className="secondary">
                  <strong>{SCORE_WORDS.economics}:</strong>{' '}
                  {econText ?? `Not available. ${econ?.null_explanation ?? 'Enter your own yield and selling price to see income.'}`}
                </p>
                <OwnFiguresControl rotations={[rotation]} />
              </div>
              <RotationDetail rotation={rotation} confirmed={rotationConfirmed} onConfirmRotation={onConfirmRotation} onChangeRotation={onChangeRotation} driestYearsOnly={analysis.scenario.rainfall.id !== 'normal'} />
            </section>
          );
        })}
      </div>
      <ul className="legend" aria-label="How to read the bars">
        <li>
          <span className="legend__swatch" data-kind="score" aria-hidden="true" />
          Bar: the score
        </li>
        <li>
          <span className="legend__swatch" data-kind="range" aria-hidden="true" />
          Box: where the score usually lands
        </li>
      </ul>
      <p className="secondary">{doubtSentence(analysis)}</p>
    </Card>
  );
}

export function SwitchCard({ analysis, id }: { analysis: Analysis; id: string }) {
  const selectId = useId();
  const current = currentOf(analysis);
  const options = alternativesOf(analysis);
  const [optionId, setOptionId] = useState(options[0]?.id ?? '');
  const option = options.find((candidate) => candidate.id === optionId) ?? options[0];

  if (!option) {
    return (
      <Card id={id} className="wide" title="What changes if you switch">
        <p className="secondary">We found no other rotation to set against what you grow now. Change your answers to see more.</p>
      </Card>
    );
  }

  const scale = deltaScale(option.tradeoffs);
  return (
    <Card id={id} className="wide" title="What changes if you switch">
      <p className="secondary">
        From {nameInSentence(current)} to {nameInSentence(option)}.
      </p>
      {options.length > 1 && (
        <div className="field">
          <label htmlFor={selectId}>Switch to</label>
          <select id={selectId} value={option.id} onChange={(event) => setOptionId(event.target.value)}>
            {options.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {shortName(candidate)}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <p className="switch-scale" aria-hidden="true">
          <span>Worse</span>
          <span>Same</span>
          <span>Better</span>
        </p>
        <ul className="plain-list">
          {byWeight(option).map((tradeoff) => {
            const verdict = verdictOf(tradeoff);
            const delta = tradeoff.score_delta ?? 0;
            const share = Math.min(Math.abs(delta) / scale, 1) * 50;
            const before = physicalWords(scoreOf(current, tradeoff.score_id), analysis.currency);
            const after = physicalWords(scoreOf(option, tradeoff.score_id), analysis.currency);
            const after_score = scoreOf(option, tradeoff.score_id);
            return (
              <li key={tradeoff.score_id} className="switch-row">
                <p className="switch-row__head">
                  <span>{SCORE_WORDS[tradeoff.score_id]}</span>
                  <span className="switch-row__verdict">{verdict.word}</span>
                </p>
                <div className="delta" aria-hidden="true">
                  {(verdict.direction === 'better' || verdict.direction === 'worse') && <span className="delta__bar" data-direction={verdict.direction} style={{ inlineSize: `${share}%` }} />}
                </div>
                {before && after && after_score?.physical_label && (
                  <p className="caption">
                    {after_score.physical_label}: {before} now, {after} after.
                  </p>
                )}
                {verdict.direction === 'unknown' && <p className="caption">One side has no value for this field, so we can’t set them side by side.</p>}
              </li>
            );
          })}
        </ul>
      </div>
      <p className="secondary">{switchClosing(option, analysis.uncertainty.n_runs)}</p>
    </Card>
  );
}

interface RiskRow {
  id: CalendarHazard;
  label: string;
  levels: number[];
}

function riskSummary(rows: RiskRow[]): string {
  const risky = (row: RiskRow) => row.levels.flatMap((level, month) => (level >= 1 ? [month] : []));
  const total = rows.reduce((sum, row) => sum + risky(row).length, 0);
  if (total === 0) return 'No risky months stand out for what you grow now.';
  const main = rows.reduce((worst, row) => (risky(row).length > risky(worst).length ? row : worst));
  const months = risky(main);
  const subject = RISK_SUBJECT[main.id];
  return `${total} risky ${total === 1 ? 'month' : 'months'} in all. ${subject.name} is the main one: ${months.length} ${months.length === 1 ? 'month' : 'months'}, ${monthSpanWords(months)}${subject.when}.`;
}

const LEVEL_WORDS = ['Low risk', 'Some risk', 'High risk'];
const LEVEL_MARKS = ['', 'S', 'H'];

export function MonthsCard({ analysis }: { analysis: Analysis }) {
  const meta = useMeta();
  const current = currentOf(analysis);
  const calendar = current.risk_calendar;
  const rows: RiskRow[] = meta.calendar_hazards.map((hazard) => {
    const id = hazard.id as CalendarHazard;
    return { id, label: RISK_WORDS[id] ?? hazard.label, levels: monthlyRisk(calendar.cells, id).map((month) => month.level ?? 0) };
  });
  const summary = riskSummary(rows);

  return (
    <Card className="narrow" title="Months to watch">
      <p className="secondary">When the weather is most likely to hurt what you grow now, {nameInSentence(current)}.</p>
      {calendar.null_reason ? (
        <MissingValue reason={calendar.null_reason} explanation={calendar.null_explanation} />
      ) : (
        <>
          <div className="risk-fit">
            <div className="risk-grid" role="img" aria-label={`Risk by month for ${nameInSentence(current)}. ${summary}`}>
              <span className="risk-grid__corner" />
              {MONTHS.map((month) => (
                <span key={month} className="risk-grid__month">
                  {month.slice(0, 1)}
                  <span className="risk-grid__month-rest">{month.slice(1, 3)}</span>
                </span>
              ))}
              {rows.map((row) => [
                <span key={row.id} className="risk-grid__label">
                  {row.label}
                </span>,
                ...row.levels.map((level, month) => (
                  <span key={`${row.id}-${month}`} className="risk-grid__cell" data-level={level} title={`${row.label}, ${MONTHS[month]}: ${LEVEL_WORDS[level]}`}>
                    {LEVEL_MARKS[level]}
                  </span>
                )),
              ])}
            </div>
          </div>
          <ul className="legend" aria-label="How to read the months">
            <li>
              <span className="legend__swatch" data-kind="high" aria-hidden="true" />H: High risk
            </li>
            <li>
              <span className="legend__swatch" data-kind="some" aria-hidden="true" />S: Some risk
            </li>
            <li>
              <span className="legend__swatch" aria-hidden="true" />
              Low risk
            </li>
          </ul>
          <p>{summary}</p>
          <EvidenceTag source={calendar} />
        </>
      )}
    </Card>
  );
}

interface SourcesProps {
  analysis: Analysis;
}

const KIND_ORDER: EvidenceKind[] = ['satellite_observation', 'ground_observation', 'soil_survey_baseline', 'model_output'];

export function SourcesCard({ analysis }: SourcesProps) {
  const covered = coveredCount(analysis.datasets);
  const total = analysis.datasets.length;
  const tally = tallyEvidence(allFigures(analysis));
  const counted = tally.total - tally.missing;
  return (
    <Card className="narrow card--quiet" title="Where the numbers come from">
      <p>
        {covered} of our {total} data sources cover your field. The rest don’t reach this area or aren’t connected yet.
      </p>
      <div className="segments" role="img" aria-label={`${covered} of ${total} data sources cover your field.`}>
        {analysis.datasets.map((dataset, index) => (
          <span key={dataset.id} data-on={index < covered} />
        ))}
      </div>
      <div>
        <p className="secondary">The {counted} numbers behind this page:</p>
        <ul className="count-list">
          {KIND_ORDER.filter((kind) => tally.counts[kind] > 0 || kind !== 'ground_observation').map((kind) => (
            <li key={kind}>
              <span>{EVIDENCE_WORDS[kind]}</span>
              <strong>{tally.counts[kind]}</strong>
            </li>
          ))}
        </ul>
        {tally.missing > 0 && (
          <p className="caption">
            {tally.missing} more could not be worked out for this field. The reason shows where {tally.missing === 1 ? 'it' : 'each'} would have appeared.
          </p>
        )}
      </div>
    </Card>
  );
}


/** Every source and every number, for the farmer or agronomist who wants to check the working. */
