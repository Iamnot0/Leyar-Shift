import type { ThemeName } from '../styles/tokens.generated';
import { Logo } from './Logo';

const REPOSITORY = 'https://github.com/Iamnot0/Leyar-Shift';

/** Closes every screen: the mark, who built it and where its code and data sources are listed, and the challenge it was built for. */
export function Footer({ theme }: { theme: ThemeName }) {
  return (
    <footer className="site-footer">
      <a className="site-footer__brand" href="/" aria-label="Leyar Shift, home">
        <Logo theme={theme} size={28} />
      </a>
      <p className="site-footer__middle">
        <span>Powered by OptimusTechnica</span>
        <a className="site-footer__link" href={REPOSITORY} target="_blank" rel="noreferrer">
          Resources
          <span className="visually-hidden"> (code and data sources, opens in a new tab)</span>
        </a>
      </p>
      <p className="site-footer__event">NASA Space Apps Challenge 2026</p>
    </footer>
  );
}
