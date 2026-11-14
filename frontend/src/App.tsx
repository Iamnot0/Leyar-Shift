import { Analytics } from '@vercel/analytics/react';
import { useEffect, useState } from 'react';
import { connect, type Connection } from './api/source';
import { MetaContext } from './app/context';
import { Planner } from './app/Planner';
import { Card, CardState, Reminder } from './components/ui/kit';
import { Header } from './shell/Header';
import { DEFAULT_THEME, themes, type ThemeName } from './styles/tokens.generated';

const THEME_STORAGE_KEY = 'field-shift-theme';

type Boot = { status: 'connecting' } | { status: 'unreachable' } | ({ status: 'ready' } & Connection);

function storedTheme(): ThemeName {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored !== null && stored in themes ? (stored as ThemeName) : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export default function App() {
  const [theme, setTheme] = useState<ThemeName>(storedTheme);
  const [boot, setBoot] = useState<Boot>({ status: 'connecting' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', theme === 'dark' ? themes.dark.ground : themes.light['green-deep']);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Storage can be blocked. The theme still applies for this visit.
    }
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const connection = await connect();
      if (!cancelled) setBoot({ status: 'ready', ...connection });
    })().catch(() => {
      if (!cancelled) setBoot({ status: 'unreachable' });
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reconnect = () => {
    setBoot({ status: 'connecting' });
    setAttempt((current) => current + 1);
  };

  const notices = boot.status === 'ready' && boot.versionWarning && (
    <p className="strip strip--care" role="note">
      {boot.versionWarning}
    </p>
  );

  return (
    <>
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      {boot.status === 'ready' ? (
        <MetaContext value={boot.meta}>
          <Planner key={attempt} client={boot.client} theme={theme} notices={notices} onThemeChange={setTheme} />
        </MetaContext>
      ) : (
        <>
          <Header live={boot.status === 'unreachable' ? false : null} theme={theme} onThemeChange={setTheme} />
          <main id="content" className="page" tabIndex={-1}>
            <Card className="boot" title={boot.status === 'connecting' ? 'Getting things ready' : 'We can’t reach the data service right now'}>
              {boot.status === 'connecting' ? (
                <CardState kind="loading" title="Connecting to the data service…" />
              ) : (
                <CardState kind="error" title="Nothing is shown until it answers." action={{ label: 'Try again', run: reconnect }}>
                  Every number here comes from live data for your field, so nothing stands in for it.
                </CardState>
              )}
            </Card>
            <Reminder />
          </main>
        </>
      )}
      <Analytics mode="production" />
    </>
  );
}
