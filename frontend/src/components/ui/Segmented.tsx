import { useId } from 'react';

interface SegmentedProps<T extends string> {
  legend: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  hideLegend?: boolean;
  /** Puts the legend beside the options instead of above them. */
  inline?: boolean;
  /** Puts the options in one column, for long labels. */
  stack?: 'always';
}

/** A small set of choices where one is on, built on native radios so arrow keys work as expected. */
export function Segmented<T extends string>({ legend, options, value, onChange, hideLegend = false, inline = false, stack }: SegmentedProps<T>) {
  const name = useId();
  return (
    <fieldset className={`segmented ${inline ? 'segmented--inline' : ''}`} data-stack={stack}>
      <legend className={hideLegend ? 'visually-hidden' : undefined}>{legend}</legend>
      <div className="segmented__options">
        {options.map((option) => (
          <label key={option.value} className="segmented__option">
            <input type="radio" name={name} value={option.value} checked={option.value === value} onChange={() => onChange(option.value)} />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
