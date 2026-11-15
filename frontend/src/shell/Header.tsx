import { MapPinIcon, MoonIcon, SunIcon, SwitchIcon } from '../components/ui/Icons';
import type { ThemeName } from '../styles/tokens.generated';
import { Logo } from './Logo';
import { revealTheme } from './themeReveal';

interface HeaderProps {
  /** Whether the data service is answering. Null until the app has asked. */
  live: boolean | null;
  theme: ThemeName;
  onThemeChange: (theme: ThemeName) => void;
  /** Active dashboard screen, when a field is set up. */
  screen?: 'home' | 'results' | null;
  /** The field in use, once there is one. */
  field?: { name: string; areaHa: string } | null;
  onChangeField?: () => void;
}

export function Header({ live, theme, onThemeChange, screen = null, field = null, onChangeField }: HeaderProps) {
  const next: ThemeName = theme === 'dark' ? 'light' : 'dark';
  return (
    <header className="header">
      <a className="brand" href="/" aria-label="Leyar Shift, home">
        <Logo theme={theme} size={36} />
      </a>
      {live !== null && (
        <p className="live" data-live={live}>
          <span className="live__dot" aria-hidden="true" />
          {live ? 'Live data' : 'Offline'}
        </p>
      )}
      {onChangeField && (
        <nav className="header-nav" aria-label="Views">
          <a className="header-nav__link" href="/" aria-current={screen === 'home' ? 'page' : undefined}>
            Field briefing
          </a>
          <a className="header-nav__link" href="/results" aria-current={screen === 'results' ? 'page' : undefined}>
            Crop rotation
          </a>
        </nav>
      )}
      {field && onChangeField ? (
        <button
          type="button"
          className="field-pill"
          title={`Change field (${field.name}, ${field.areaHa} ha)`}
          onClick={onChangeField}
        >
          <span className="field-pill__pin" aria-hidden="true">
            <MapPinIcon />
          </span>
          <span className="field-pill__name">{field.name}</span>
          <span className="field-pill__fixed field-pill__meta">· {field.areaHa} ha</span>
          <span className="field-pill__badge" aria-hidden="true">
            <SwitchIcon />
          </span>
          <span className="visually-hidden">Change field</span>
        </button>
      ) : (
        onChangeField && (
          <button
            type="button"
            className="field-pill field-pill--setup"
            title="Set up your field"
            aria-current={screen === null ? 'page' : undefined}
            onClick={onChangeField}
          >
            <span className="field-pill__pin" aria-hidden="true">
              <MapPinIcon />
            </span>
            <span className="field-pill__name">Set up field</span>
          </button>
        )
      )}
      <button
        type="button"
        className="icon-button theme-toggle"
        aria-label={`Switch to the ${next} theme`}
        onClick={(event) => {
          const button = event.currentTarget;
          revealTheme(button, () => onThemeChange(next));
        }}
      >
        <span className="theme-toggle__icon theme-toggle__icon--sun" aria-hidden="true">
          <SunIcon />
        </span>
        <span className="theme-toggle__icon theme-toggle__icon--moon" aria-hidden="true">
          <MoonIcon />
        </span>
      </button>
    </header>
  );
}
