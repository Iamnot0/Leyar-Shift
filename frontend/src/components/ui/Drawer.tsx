import type { ReactNode } from 'react';

interface DrawerProps {
  title: string;
  /** How many items wait inside, so the farmer can judge whether to open it. */
  count?: number;
  children: ReactNode;
}

/** Secondary material, closed until it is asked for, so a view leads with its answer. */
export function Drawer({ title, count, children }: DrawerProps) {
  return (
    <details className="drawer">
      <summary>
        <span className="drawer__title">{title}</span>
        {count !== undefined && <span className="drawer__count">{count}</span>}
      </summary>
      <div className="drawer__body">{children}</div>
    </details>
  );
}
