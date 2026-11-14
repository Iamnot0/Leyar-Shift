import { themes } from '../styles/tokens.generated';
import type { ThemeName } from '../styles/tokens.generated';

const PETAL = 'M64 56Q62 27 98 22Q94 52 64 56Z';
const PETAL_TURNS = [0, 90, 180, 270];
const FILLS_ON_LIGHT = ['#F4B740', '#123B2A', '#1D6A46', '#7FA98F'];
const FILLS_ON_DARK = ['#F4B740', '#F3F5F0', '#7FA98F', '#B9D3C3'];

const MIN_SIZE_PX = 16;

interface LogoProps {
  theme: ThemeName;
  /** Set where the background does not follow the theme, such as the deep green answer card. */
  surface?: ThemeName;
  size?: number;
  /** Show the lowercase live-text wordmark beside the mark. */
  showWordmark?: boolean;
}

export function Logo({ theme, surface, size = 36, showWordmark = true }: LogoProps) {
  const fills = (surface ?? theme) === 'dark' ? FILLS_ON_DARK : FILLS_ON_LIGHT;
  const markSize = Math.max(MIN_SIZE_PX, size);
  const labelProps = showWordmark ? { 'aria-hidden': true as const } : { role: 'img' as const, 'aria-label': 'Leyar Shift' };
  return (
    <>
      <svg className="brand__mark" width={markSize} height={markSize} viewBox="18 18 84 84" focusable="false" {...labelProps}>
        {PETAL_TURNS.map((turn, index) => (
          <path key={turn} d={PETAL} fill={fills[index]} transform={turn ? `rotate(${turn} 60 60)` : undefined} />
        ))}
      </svg>
      {showWordmark && (
        <span className="brand__word" style={surface && { color: themes[surface]['brand-word'] }}>
          leyar shift
        </span>
      )}
    </>
  );
}
