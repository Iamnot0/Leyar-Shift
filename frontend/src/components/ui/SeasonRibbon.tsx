import { cropName, labelOf, useAnalysisScope, useMeta } from '../../app/context';
import type { CoverCalendar, CoverState } from '../../api/types';
import { describeYear, toRuns, yearsOf } from '../../lib/calendar';
import { MONTHS, sentenceCase } from '../../lib/format';

const CHARACTERS_PER_MONTH = 3;

/** A label is drawn only where it fits at phone width; the list under the ribbon always carries the words. */
function fitsLabel(label: string, months: number): boolean {
  return label.length + 1 <= months * CHARACTERS_PER_MONTH;
}

const lastWord = (text: string) => sentenceCase(text.split(' ').at(-1) ?? text);
const firstWord = (text: string) => text.split(' ')[0];

export function MonthAxis() {
  return (
    <div className="month-axis" aria-hidden="true">
      {MONTHS.map((month) => (
        <span key={month}>
          <span className="month-axis__short">{month.charAt(0)}</span>
          <span className="month-axis__long">{month.slice(0, 3)}</span>
        </span>
      ))}
    </div>
  );
}

export function RibbonLegend() {
  const meta = useMeta();
  return (
    <ul className="legend" aria-label="How to read the ribbons">
      {meta.cover_states.map((state) => (
        <li key={state.id}>
          <span className="ribbon__segment legend__swatch" data-state={state.id} aria-hidden="true" />
          {state.label}
        </li>
      ))}
    </ul>
  );
}

interface SeasonRibbonProps {
  calendar: CoverCalendar;
  rotationName: string;
}

/** The twelve-month band, one row per year of the rotation, with the same content in words beneath it. */
export function SeasonRibbon({ calendar, rotationName }: SeasonRibbonProps) {
  const meta = useMeta();
  const { crops } = useAnalysisScope();
  const years = yearsOf(calendar.cells);
  const multiYear = years.length > 1;
  const stateWords = (state: CoverState) => labelOf(meta.cover_states, state);
  const cropWords = (id: string | null) => cropName(crops, id);

  return (
    <div className="ribbon">
      <MonthAxis />
      <div role="img" aria-label={`Season ribbon for ${rotationName}. The list that follows says the same in words.`}>
        {years.map((months, yearIndex) => (
          <div key={yearIndex} className="ribbon__year">
            {multiYear && <p className="ribbon__year-label">Year {yearIndex + 1}</p>}
            <div className="ribbon__row">
              {toRuns(months).map((run) => {
                const label = run.state === 'crop' ? lastWord(cropWords(run.cropId)) : firstWord(stateWords(run.state));
                return (
                  <div key={run.start} className="ribbon__segment" data-state={run.state} style={{ gridColumn: `${run.start + 1} / span ${run.length}` }}>
                    {fitsLabel(label, run.length) && <span className="ribbon__label">{label}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <ul className="ribbon__text">
        {years.map((months, yearIndex) => (
          <li key={yearIndex}>
            {multiYear && <strong>Year {yearIndex + 1}: </strong>}
            {describeYear(months, stateWords, cropWords)}
          </li>
        ))}
      </ul>
    </div>
  );
}
