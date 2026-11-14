import { useId, useRef, useState } from 'react';
import { descriptionOf, labelOf, useAnalysisScope, useMeta } from '../../app/context';
import { COVERAGE_WORDS, EVIDENCE_WORDS } from '../../content/copy';
import { datasetsFor, describeResolution, isSparse, type Sourced } from '../../lib/evidence';
import { formatPeriod, joinList } from '../../lib/format';
import { ChevronIcon, EvidenceIcon } from './Icons';

/** Where a value came from: a labelled tag that opens the NASA and soil evidence behind it. */
export function EvidenceTag({ source }: { source: Sourced }) {
  const meta = useMeta();
  const { datasets } = useAnalysisScope();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  const kind = source.evidence_kind;
  if (kind === null) return null;

  const label = EVIDENCE_WORDS[kind];
  const sparse = isSparse(source);
  const resolution = describeResolution(source);
  const sources = datasetsFor(source, datasets);
  const scopes = [...new Set(sources.map((dataset) => COVERAGE_WORDS[dataset.coverage_scope]))];
  const hasReadings = source.n_valid_obs != null && source.n_expected_obs != null;

  return (
    <div
      className="evidence"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        event.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="evidence__tag"
        data-kind={kind}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`${label}${sparse ? ', few readings' : ''}. Show where this number comes from.`}
        onClick={() => setOpen((current) => !current)}
      >
        <EvidenceIcon kind={kind} />
        <span>{label}</span>
        {sparse && <span className="evidence__sparse">few readings</span>}
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div id={panelId} className="evidence__panel" role="group" aria-label={`${label}: where this number comes from`}>
          <p>{descriptionOf(meta.evidence_kinds, kind)}</p>
          <dl>
            {sources.length > 0 && (
              <div>
                <dt>Source</dt>
                <dd>{joinList(sources.map((dataset) => dataset.name))}</dd>
              </div>
            )}
            {resolution && (
              <div>
                <dt>Detail</dt>
                <dd>{resolution}</dd>
              </div>
            )}
            {source.period && (
              <div>
                <dt>Period</dt>
                <dd>{formatPeriod(source.period)}</dd>
              </div>
            )}
            {hasReadings && (
              <div>
                <dt>Readings</dt>
                <dd>
                  {source.n_valid_obs} of {source.n_expected_obs} expected
                  {sparse && '. Treat this as rough.'}
                </dd>
              </div>
            )}
            {source.access_tier && (
              <div>
                <dt>How we got it</dt>
                <dd>{labelOf(meta.access_tiers, source.access_tier)}</dd>
              </div>
            )}
            {scopes.length > 0 && (
              <div>
                <dt>Source covers</dt>
                <dd>{joinList(scopes)}</dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}
