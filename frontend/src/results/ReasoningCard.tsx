import { useEffect, useState } from 'react';
import { toApiError, type ApiClient, type ApiError } from '../api/client';
import type { Dataset, Reasoning, ReasoningFact, ReasoningSummary } from '../api/types';
import { Card, CardState } from '../components/ui/kit';

type ReasoningState = { status: 'loading' } | { status: 'ready'; reasoning: Reasoning } | { status: 'failed'; error: ApiError };

function useReasoning(client: ApiClient, analysisId: string): [ReasoningState, () => void] {
  const [state, setState] = useState<ReasoningState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    client
      .getReasoning(analysisId)
      .then((reasoning) => current && setState({ status: 'ready', reasoning }))
      .catch((error: unknown) => current && setState({ status: 'failed', error: toApiError(error) }));
    return () => {
      current = false;
    };
  }, [client, analysisId, attempt]);
  const retry = () => {
    setState({ status: 'loading' });
    setAttempt((count) => count + 1);
  };
  return [state, retry];
}

/** Facts in the order the engine gave them, gathered under the rotation, crop or set each belongs to. */
function grouped(facts: ReasoningFact[]): [string | null, ReasoningFact[]][] {
  const groups = new Map<string | null, ReasoningFact[]>();
  for (const fact of facts) groups.set(fact.group, [...(groups.get(fact.group) ?? []), fact]);
  return [...groups];
}

function FactList({ facts, datasets }: { facts: ReasoningFact[]; datasets: Dataset[] }) {
  return grouped(facts).map(([group, items]) => (
    <div key={group ?? ''} className="reasoning__group">
      {group && <h4>{group}</h4>}
      <dl className="measures">
        {items.map((fact) => {
          const names = fact.dataset_ids.map((id) => datasets.find((dataset) => dataset.id === id)?.name ?? id).filter((name) => name !== fact.label);
          return (
            <div key={`${fact.source} ${fact.label}`} className="measures__row">
              <dt className="measures__label">{fact.label}</dt>
              <dd className="reasoning__fact">
                <span>{fact.text}</span>
                <span className="reasoning__source">
                  <code>{fact.source}</code>
                  {names.length > 0 && ` · ${names.join(', ')}`}
                </span>
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  ));
}

function Byline({ summary }: { summary: ReasoningSummary }) {
  if (summary.status === 'accepted') {
    return <p className="caption">Summary written by {summary.model} from the numbers above. Every number in it was checked against them.</p>;
  }
  if (summary.status === 'not_configured') return <p className="caption">Summary written by the engine from the numbers above.</p>;
  return (
    <p className="caption">
      The AI summary was not used. {summary.status_note} This summary was written by the engine from the numbers above.
    </p>
  );
}

function Summary({ summary }: { summary: ReasoningSummary }) {
  return (
    <section className="reasoning__summary" aria-labelledby="reasoning-summary">
      <h3 id="reasoning-summary">In short</h3>
      <p>{summary.text}</p>
      <Byline summary={summary} />
      {summary.facts_given.length > 0 && (
        <details className="drawer">
          <summary>
            <span className="drawer__title">What the model was given</span>
            <span className="drawer__count">
              {summary.facts_given.length}
              <span className="visually-hidden"> facts</span>
            </span>
          </summary>
          <div className="drawer__body">
            <ul className="reasoning__given">
              {summary.facts_given.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </details>
      )}
    </section>
  );
}

/** The engine's steps behind this result, in order, with every number it used and where each was read. */
export function ReasoningCard({ client, analysisId, datasets }: { client: ApiClient; analysisId: string; datasets: Dataset[] }) {
  const [state, retry] = useReasoning(client, analysisId);
  return (
    <Card title="How we worked this out" className="reasoning">
      <p className="secondary">The steps our calculation took, in order. Open a step to see each number it used and where in the results it was read.</p>
      {state.status === 'loading' && <CardState kind="loading" title="Reading the steps behind these results" />}
      {state.status === 'failed' && (
        <CardState kind="error" title="We could not load the steps" action={state.error.retryable ? { label: 'Try again', run: retry } : undefined}>
          {state.error.problem.detail} The results above are not affected.
        </CardState>
      )}
      {state.status === 'ready' && (
        <>
          <ol className="reasoning__steps">
            {state.reasoning.steps.map((step, index) => (
              <li key={step.id}>
                <details className="drawer">
                  <summary>
                    <span className="reasoning__index number">{index + 1}</span>
                    <span className="drawer__title">{step.title}</span>
                    <span className="drawer__count">
                      {step.facts.length}
                      <span className="visually-hidden"> facts</span>
                    </span>
                  </summary>
                  <div className="drawer__body">
                    <p className="secondary">{step.method}</p>
                    <FactList facts={step.facts} datasets={datasets} />
                  </div>
                </details>
              </li>
            ))}
          </ol>
          <Summary summary={state.reasoning.summary} />
        </>
      )}
    </Card>
  );
}
