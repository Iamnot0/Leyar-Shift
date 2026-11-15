import { flushSync } from 'react-dom';

/**
 * Applies a theme change as a circle that grows from the button to the farthest corner of the screen.
 * The circle itself is a CSS animation on the view transition (app.css), which every browser with the API runs.
 * Without the View Transitions API, or when reduced motion is asked for, the theme simply switches.
 */
export function revealTheme(origin: HTMLElement, apply: () => void): void {
  if (typeof document.startViewTransition !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    apply();
    return;
  }
  const box = origin.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const root = document.documentElement.style;
  root.setProperty('--reveal-x', `${x}px`);
  root.setProperty('--reveal-y', `${y}px`);
  root.setProperty('--reveal-r', `${Math.ceil(radius)}px`);
  // The new theme must be on the page before the browser takes its after picture, so React renders it at once.
  document.startViewTransition(() => flushSync(apply));
}
