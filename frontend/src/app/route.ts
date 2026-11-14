import { useCallback, useEffect, useState } from 'react';
import { SETUP_STEPS } from '../content/copy';

export type Route = { screen: 'home'; explicit?: boolean } | { screen: 'results' } | { screen: 'setup'; step: number };

const STEP_COUNT = SETUP_STEPS.length;

function parse(hash: string): Route {
  const [, screen, detail] = hash.split('/');
  if (screen === 'results') return { screen: 'results' };
  if (screen === 'setup') {
    const step = Number(detail);
    return { screen: 'setup', step: Number.isInteger(step) && step >= 1 && step <= STEP_COUNT ? step - 1 : 0 };
  }
  return { screen: 'home', explicit: hash === '#/' || hash === '#/home' };
}

export function hrefOf(route: Route): string {
  if (route.screen === 'setup') return `#/setup/${route.step + 1}`;
  return route.screen === 'results' ? '#/results' : '#/';
}

/** The screen named by the address, so the browser's back button and a reload both land where the farmer was. */
export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const navigate = useCallback((next: Route) => {
    if (window.location.hash === hrefOf(next)) setRoute(next);
    else window.location.hash = hrefOf(next);
  }, []);
  return [route, navigate];
}
