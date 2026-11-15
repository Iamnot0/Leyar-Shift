import { flushSync } from 'react-dom';

const REVEAL_MS = 520;
const REVEAL_EASING = 'cubic-bezier(0.2, 0.7, 0.2, 1)';

/**
 * Applies a theme change as a circle that grows from the button to the farthest corner of the screen.
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
  // The new theme must be on the page before the browser takes its after picture, so React renders it at once.
  const transition = document.startViewTransition(() => flushSync(apply));
  transition.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: REVEAL_MS, easing: REVEAL_EASING, pseudoElement: '::view-transition-new(root)' },
      );
    })
    .catch(() => {
      // A skipped transition still applied the theme; only the animation is lost.
    });
}
