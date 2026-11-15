import { useCallback, useEffect, useState } from 'react';
import { SETUP_STEPS } from '../content/copy';

export type Route = { screen: 'home' } | { screen: 'overview' } | { screen: 'results' } | { screen: 'resources' } | { screen: 'setup'; step: number };

const STEP_COUNT = SETUP_STEPS.length;
const ROUTE_CHANGE = 'leyar:route';

function parse(path: string): Route {
  const [, screen, detail] = path.split('/');
  if (screen === 'overview') return { screen: 'overview' };
  if (screen === 'results') return { screen: 'results' };
  if (screen === 'resources') return { screen: 'resources' };
  if (screen === 'setup') {
    const step = Number(detail);
    return { screen: 'setup', step: Number.isInteger(step) && step >= 1 && step <= STEP_COUNT ? step - 1 : 0 };
  }
  return { screen: 'home' };
}

export function hrefOf(route: Route): string {
  if (route.screen === 'setup') return `/setup/${route.step + 1}`;
  if (route.screen === 'resources') return '/resources';
  if (route.screen === 'overview') return '/overview';
  return route.screen === 'results' ? '/results' : '/';
}

function isAppPath(path: string): boolean {
  return path === '/' || path === '/overview' || path === '/results' || path === '/resources' || /^\/setup\/\d+$/.test(path);
}

function go(path: string): void {
  if (window.location.pathname !== path) window.history.pushState(null, '', path);
  window.dispatchEvent(new Event(ROUTE_CHANGE));
}

// Addresses from before the switch to plain paths (/#/results) still land on the same screen.
function adoptHashAddress(): void {
  const { hash } = window.location;
  if (hash.startsWith('#/')) window.history.replaceState(null, '', hrefOf(parse(hash.slice(1))));
}

/** The screen named by the address, so the browser's back button and a reload both land where the farmer was. */
export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState(() => {
    adoptHashAddress();
    return parse(window.location.pathname);
  });

  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.pathname));
    // Links to app screens change the screen in place; in-page anchors such as the skip link keep their default.
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest('a');
      if (!anchor || anchor.target || anchor.hasAttribute('download') || anchor.origin !== window.location.origin) return;
      if (!isAppPath(anchor.pathname) || (anchor.hash && anchor.pathname === window.location.pathname)) return;
      event.preventDefault();
      go(anchor.pathname);
    };
    window.addEventListener('popstate', onChange);
    window.addEventListener(ROUTE_CHANGE, onChange);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('popstate', onChange);
      window.removeEventListener(ROUTE_CHANGE, onChange);
      document.removeEventListener('click', onClick);
    };
  }, []);

  const navigate = useCallback((next: Route) => go(hrefOf(next)), []);
  return [route, navigate];
}
