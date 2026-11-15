import type { ThemeName } from '../styles/tokens.generated';
import { Logo } from './Logo';

/** Closes every screen: the mark, who built it and where its sources are listed, and the challenge it was built for. */
export function Footer({ theme }: { theme: ThemeName }) {
  return (
    <footer className="site-footer">
      <a className="site-footer__brand" href="/" aria-label="Leyar Shift, home">
        <Logo theme={theme} size={28} />
      </a>
      <p className="site-footer__middle">
        <span>Powered by OptimusTechnica</span>
        <a className="site-footer__link" href="/resources">
          Resources
        </a>
      </p>
      <p className="site-footer__event">NASA Space Apps Challenge 2026</p>
    </footer>
  );
}
