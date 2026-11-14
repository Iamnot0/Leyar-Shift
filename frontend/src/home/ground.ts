import type { Reading, SoilMoisture } from '../api/fieldBriefing';
import { monthOf } from './words';

/** How wet the ground is against what is usual for the month. One reading of it, shared by every card, so they cannot disagree. */
export interface Ground {
  state: 'dry' | 'usual' | 'wet';
  month: string;
  /** Which reading it rests on, in words. */
  where: string;
}

export function groundOf(surface: Reading<SoilMoisture>, rootZone: Reading<SoilMoisture>): Ground | null {
  const main = rootZone.available ? rootZone : surface;
  if (!main.available) return null;
  const state = main.usualLow !== null && main.now < main.usualLow ? 'dry' : main.usualHigh !== null && main.now > main.usualHigh ? 'wet' : 'usual';
  return { state, month: monthOf(main.readOn), where: rootZone.available ? 'where the roots are' : 'at the surface' };
}
