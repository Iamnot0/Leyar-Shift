import type { ReactNode } from 'react';
import { useAnalysisScope } from '../../app/context';
import type { LocalReview, NullReason, Quantity } from '../../api/types';
import { NULL_REASON_WORDS, REVIEWER_WORDS } from '../../content/copy';
import { formatRange, formatValue } from '../../lib/format';
import { EvidenceTag } from './EvidenceTag';
import { FlagIcon, MissingIcon } from './Icons';

interface MissingValueProps {
  reason: NullReason;
  explanation: string | null;
  retryable?: boolean;
}

/** A value that could not be provided. It states the reason and never stands in a number, zero or dash. */
export function MissingValue({ reason, explanation, retryable = false }: MissingValueProps) {
  const { retry } = useAnalysisScope();
  return (
    <div className="missing">
      <span className="missing__swatch" aria-hidden="true">
        <MissingIcon />
      </span>
      <p className="missing__text">
        <strong>{NULL_REASON_WORDS[reason]}.</strong> {explanation}
      </p>
      {retryable && (
        <button type="button" className="button" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}

interface QuantityViewProps {
  quantity: Quantity;
  /** Shown before the value, for rows that are not already labelled by a heading. */
  lead?: ReactNode;
  /** False where one tag already covers this number and its neighbours. */
  evidence?: boolean;
}

/** A number with its likely range and its evidence tag, or the reason it is missing. */
export function QuantityView({ quantity, lead, evidence = true }: QuantityViewProps) {
  const { currency } = useAnalysisScope();
  if (quantity.value === null) {
    return (
      <div className="figure">
        {lead}
        <MissingValue reason={quantity.null_reason ?? 'not_configured'} explanation={quantity.null_explanation} retryable={quantity.retryable} />
      </div>
    );
  }
  const hasRange = quantity.low !== null && quantity.high !== null && quantity.low !== quantity.high;
  return (
    <div className="figure">
      {lead}
      <span className="figure__value">{formatValue(quantity.value, quantity.unit, currency)}</span>
      {hasRange && quantity.low !== null && quantity.high !== null && <span className="figure__range">usually {formatRange(quantity.low, quantity.high, quantity.unit, currency)}</span>}
      {evidence && <EvidenceTag source={quantity} />}
      {quantity.needs_local_judgment && (
        <span className="figure__flag">
          <FlagIcon /> Check on your own land
        </span>
      )}
      {quantity.note && <span className="figure__note">{quantity.note}</span>}
    </div>
  );
}

/** Marks a point the tool cannot settle. Independent of evidence kind, and not a risk warning. */
export function LocalJudgment({ review }: { review: LocalReview }) {
  return (
    <li className="local-judgment">
      <FlagIcon />
      <p>
        <strong>
          Check on your own land: {review.topic.toLowerCase()}.
        </strong>{' '}
        {review.text} <span className="local-judgment__who">Ask: {REVIEWER_WORDS[review.reviewer]}.</span>
      </p>
    </li>
  );
}
