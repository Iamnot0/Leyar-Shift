import { useEffect, useState, type CSSProperties } from 'react';
import { toApiError, type ApiClient, type ApiError } from '../api/client';
import type { Reasoning, ReasoningStep, ReasoningSummary } from '../api/types';
import { CheckIcon } from '../components/ui/Icons';
import { Pill } from '../components/ui/kit';

type TraceState = { status: 'closed' } | { status: 'loading' } | { status: 'ready'; reasoning: Reasoning } | { status: 'failed'; error: ApiError };

const FACTS_SHOWN = 3;

function Step({ step, index }: { step: ReasoningStep; index: number }) {
  const shown = step.facts.slice(0, FACTS_SHOWN);
  const rest = step.facts.slice(FACTS_SHOWN);
  return (
    <li className="trace__step" style={{ '--step': index } as CSSProperties}>
      <span className="trace__mark" aria-hidden="true">
        <CheckIcon size={14} />
      </span>
      <div className="trace__body">
        <p className="trace__title">{step.title}</p>
        <p className="trace__method">{step.method}</p>
        {shown.length > 0 && (
          <ul className="trace__facts">
            {shown.map((fact) => (
              <li key={`${fact.source} ${fact.label}`}>
                <span className="trace__label">{fact.group ? `${fact.group} · ${fact.label}` : fact.label}:</span> {fact.text}
              </li>
            ))}
          </ul>
        )}
        {rest.length > 0 && (
          <details className="trace__more">
            <summary>
              {rest.length} more number{rest.length === 1 ? '' : 's'}
            </summary>
            <ul className="trace__facts">
              {rest.map((fact) => (
                <li key={`${fact.source} ${fact.label}`}>
                  <span className="trace__label">{fact.group ? `${fact.group} · ${fact.label}` : fact.label}:</span> {fact.text}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </li>
  );
}

function byline(summary: ReasoningSummary): string {
  if (summary.status === 'accepted') return `Written by ${summary.model} from the numbers above. Every number in it was checked against them.`;
  if (summary.status === 'not_configured') return 'Written by the engine from the numbers above.';
  return `The SI summary was not used. ${summary.status_note ?? ''} The engine wrote this one from the numbers above.`.replace(/\s+/g, ' ');
}

/** The steps behind a result as a short trace, with an SI-written summary checked against the engine's own numbers. */
export function ProcessingPanel({ client, analysisId }: { client: ApiClient; analysisId: string }) {
  const [state, setState] = useState<TraceState>({ status: 'closed' });
  const [attempt, setAttempt] = useState(0);
  const wanted = state.status !== 'closed';

  useEffect(() => {
    if (!wanted) return;
    let current = true;
    client
      .getReasoning(analysisId)
      .then((reasoning) => current && setState({ status: 'ready', reasoning }))
      .catch((error: unknown) => current && setState({ status: 'failed', error: toApiError(error) }));
    return () => {
      current = false;
    };
    // Read once per analysis, the first time the panel opens.
  }, [client, analysisId, attempt, wanted]);

  const meta =
    state.status === 'ready'
      ? `${state.reasoning.steps.length} steps${state.reasoning.summary.status === 'accepted' ? ' · SI summary checked' : ''}`
      : 'How this result was worked out';

  return (
    <details
      className="processing"
      onToggle={(event) => {
        if (event.currentTarget.open && state.status === 'closed') setState({ status: 'loading' });
      }}
    >
      <summary className="processing__head">
        <span className="processing__title">Processing</span>
        <Pill tone="neutral">SI powered</Pill>
        <span className="processing__meta">{meta}</span>
      </summary>
      <div className="processing__body" aria-live="polite">
        {state.status === 'loading' && <p className="processing__thinking">Thinking through the steps behind this result…</p>}
        {state.status === 'failed' && (
          <p className="processing__thinking">
            {state.error.problem.detail} The result above is not affected.{' '}
            {state.error.retryable && (
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setState({ status: 'loading' });
                  setAttempt((count) => count + 1);
                }}
              >
                Try again
              </button>
            )}
          </p>
        )}
        {state.status === 'ready' && (
          <>
            <ol className="trace">
              {state.reasoning.steps.map((step, index) => (
                <Step key={step.id} step={step} index={index} />
              ))}
            </ol>
            <section className="processing__summary" style={{ '--step': state.reasoning.steps.length } as CSSProperties} aria-labelledby={`${analysisId}-summary`}>
              <p id={`${analysisId}-summary`} className="trace__title">
                In short
              </p>
              <p>{state.reasoning.summary.text}</p>
              <p className="caption">{byline(state.reasoning.summary)}</p>
            </section>
          </>
        )}
      </div>
    </details>
  );
}
