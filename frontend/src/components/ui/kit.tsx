import { useId, type ReactNode } from 'react';
import { REMINDER } from '../../content/copy';

interface CardProps {
  title?: string;
  /** A quiet title, for reading cards whose large value does the talking. */
  smallTitle?: boolean;
  /** Sits opposite the title: a status pill, usually. */
  aside?: ReactNode;
  answer?: boolean;
  id?: string;
  className?: string;
  children: ReactNode;
}

export function Card({ title, smallTitle = false, aside, answer = false, id, className = '', children }: CardProps) {
  const titleId = useId();
  return (
    <section id={id} className={`card ${answer ? 'card--answer' : ''} ${className}`} aria-labelledby={title ? titleId : undefined} tabIndex={id ? -1 : undefined}>
      {(title || aside) && (
        <header className="card__head">
          {title && (
            <h2 id={titleId} className={`card__title ${smallTitle ? 'card__title--small' : ''}`}>
              {title}
            </h2>
          )}
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

export type PillTone = 'good' | 'care' | 'amber' | 'neutral' | 'quiet';

export function Pill({ tone = 'neutral', children }: { tone?: PillTone; children: ReactNode }) {
  return (
    <span className="pill" data-tone={tone}>
      {children}
    </span>
  );
}

interface AnswerCardProps {
  pill: string;
  headline: ReactNode;
  smallHeadline?: boolean;
  id?: string;
  className?: string;
  children?: ReactNode;
}

/** The one loud thing on a screen: the conclusion, on deep green. */
export function AnswerCard({ pill, headline, smallHeadline = false, id, className = '', children }: AnswerCardProps) {
  const titleId = useId();
  return (
    <section id={id} className={`card card--answer ${className}`} aria-labelledby={titleId}>
      <Pill tone="amber">{pill}</Pill>
      <h2 id={titleId} className={`answer-headline ${smallHeadline ? 'answer-headline--small' : ''}`}>
        {headline}
      </h2>
      {children}
    </section>
  );
}

export function Tile({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="panel">
      <span className="panel__label">{label}</span>
      <span className="panel__value number">{value}</span>
      {note && <span className="caption">{note}</span>}
    </div>
  );
}

interface CardStateProps {
  kind: 'loading' | 'empty' | 'error';
  title: string;
  children?: ReactNode;
  action?: { label: string; run: () => void };
}

/** What a card shows instead of data: what is happening or what went wrong, and what to do next. */
export function CardState({ kind, title, children, action }: CardStateProps) {
  return (
    <div className="state" data-state={kind} role={kind === 'error' ? 'alert' : kind === 'loading' ? 'status' : undefined}>
      <p className="state__title">{title}</p>
      {kind === 'loading' && (
        <div className="skeleton" aria-hidden="true" style={{ inlineSize: '100%' }}>
          <span />
          <span />
          <span />
        </div>
      )}
      {children && <p className="secondary">{children}</p>}
      {action && (
        <button type="button" className="button" onClick={action.run}>
          {action.label}
        </button>
      )}
    </div>
  );
}

interface ToggleGroupProps<T extends string> {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

/** A few choices where one is on: real buttons that say which is pressed. */
export function ToggleGroup<T extends string>({ label, options, value, onChange }: ToggleGroupProps<T>) {
  return (
    <div className="segmented__options" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" className="segmented__button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Reminder() {
  return <p className="reminder">{REMINDER}</p>;
}
