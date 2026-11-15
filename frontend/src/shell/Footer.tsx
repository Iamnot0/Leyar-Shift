import { DATA_SOURCES } from '../content/sources';
import type { ThemeName } from '../styles/tokens.generated';
import { Logo } from './Logo';

/** Closes every screen: the mark, who built it and the data sources it reads, and the challenge it was built for. */
export function Footer({ theme }: { theme: ThemeName }) {
  return (
    <footer className="site-footer">
      <a className="site-footer__brand" href="/" aria-label="Leyar Shift, home">
        <Logo theme={theme} size={28} />
      </a>
      <div className="site-footer__middle">
        <span>Powered by OptimusTechnica</span>
        <details className="site-footer__resources">
          <summary className="site-footer__link">Resources</summary>
          <div className="site-footer__panel">
            <p className="site-footer__panel-title">The {DATA_SOURCES.length} data sources Leyar Shift reads</p>
            <ul className="site-footer__sources">
              {DATA_SOURCES.map((source) => (
                <li key={source.name}>
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.name}
                  </a>
                  <span className="secondary">{source.provider}</span>
                </li>
              ))}
            </ul>
          </div>
        </details>
      </div>
      <p className="site-footer__event">NASA Space Apps Challenge 2026</p>
    </footer>
  );
}
