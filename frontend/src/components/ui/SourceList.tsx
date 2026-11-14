import type { Dataset } from '../../api/types';
import { COVERAGE_WORDS, NULL_REASON_WORDS } from '../../content/copy';
import { Pill, type PillTone } from './kit';

function status(dataset: Dataset): { words: string; tone: PillTone } {
  if (dataset.status === 'available') return { words: 'Covers your field', tone: 'good' };
  if (dataset.null_reason === 'out_of_coverage') return { words: COVERAGE_WORDS[dataset.coverage_scope], tone: 'neutral' };
  return { words: NULL_REASON_WORDS[dataset.null_reason ?? 'not_configured'], tone: 'care' };
}

/** Each source, leading with what it is in plain words, then its name and what stands in for it when it is missing. */
export function SourceList({ datasets }: { datasets: Dataset[] }) {
  return (
    <ul className="source-list">
      {datasets.map((dataset) => {
        const [what, ...rest] = dataset.role.split('. ');
        const pill = status(dataset);
        return (
          <li key={dataset.id}>
            <p>
              <strong>{what.replace(/\.$/, '')}:</strong> {dataset.name}.{rest.length > 0 && ` ${rest.join('. ')}`}
            </p>
            <Pill tone={pill.tone}>{pill.words}</Pill>
          </li>
        );
      })}
    </ul>
  );
}
