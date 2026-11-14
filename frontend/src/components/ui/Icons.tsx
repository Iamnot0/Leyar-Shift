import type { ReactNode } from 'react';
import type { EvidenceKind } from '../../api/types';

function Glyph({ children, size = 24 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      className="glyph"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const EVIDENCE_GLYPHS: Record<EvidenceKind, ReactNode> = {
  satellite_observation: (
    <>
      <rect x="9" y="8" width="6" height="6" />
      <rect x="2" y="9" width="5" height="4" />
      <rect x="17" y="9" width="5" height="4" />
      <path d="M7 11h2M15 11h2M12 14v4M8 21a4 4 0 0 1 8 0" />
    </>
  ),
  ground_observation: (
    <>
      <path d="M7 3h10l-2 7H9z" />
      <path d="M12 10v10M5 20h14" />
    </>
  ),
  soil_survey_baseline: (
    <>
      <rect x="4" y="4" width="16" height="16" />
      <path d="M4 10h16M4 15h16" />
    </>
  ),
  model_output: <path d="M3 18c4 0 5-12 9-12s5 8 9 8" strokeDasharray="3 3" />,
};

export function EvidenceIcon({ kind }: { kind: EvidenceKind }) {
  return <Glyph>{EVIDENCE_GLYPHS[kind]}</Glyph>;
}

export function FlagIcon() {
  return (
    <Glyph>
      <path d="M6 21V4M6 5h12l-3 4 3 4H6" />
    </Glyph>
  );
}

export function MissingIcon() {
  return (
    <Glyph>
      <circle cx="12" cy="12" r="8" />
      <path d="M6.5 17.5l11-11" />
    </Glyph>
  );
}

export function ChevronIcon({ open }: { open: boolean }) {
  return <Glyph size={16}>{open ? <path d="M5 15l7-7 7 7" /> : <path d="M5 9l7 7 7-7" />}</Glyph>;
}

export function CheckIcon({ size = 20 }: { size?: number }) {
  return (
    <Glyph size={size}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Glyph>
  );
}

export function InfoIcon() {
  return (
    <Glyph>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.5" />
    </Glyph>
  );
}

export function BellIcon() {
  return (
    <Glyph>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4" />
    </Glyph>
  );
}

export function SunIcon() {
  return (
    <Glyph size={22}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
    </Glyph>
  );
}

export function MoonIcon() {
  return (
    <Glyph size={22}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    </Glyph>
  );
}

export function BackIcon() {
  return (
    <Glyph size={18}>
      <path d="M15 5l-7 7 7 7" />
    </Glyph>
  );
}

export function MapPinIcon() {
  return (
    <Glyph size={16}>
      <path d="M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10z" />
      <circle cx="12" cy="11" r="2.2" />
    </Glyph>
  );
}

export function SwitchIcon() {
  return (
    <Glyph size={15}>
      <path d="M16 3l4 4-4 4M4 7h16M8 21l-4-4 4-4M20 17H4" />
    </Glyph>
  );
}
