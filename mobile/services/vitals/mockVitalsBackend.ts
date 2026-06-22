import { VITALS_SCENARIO } from '../../lib/featureFlags';
import type { Vitals, VitalsBackend } from './types';
import { BASELINE_VITALS, nextVitals } from './simulator';

let current: Vitals = BASELINE_VITALS;
let staleEmitted = false;

export const mockVitalsBackend: VitalsBackend = {
  async getCurrent() {
    if (VITALS_SCENARIO === 'empty') return null;
    if (VITALS_SCENARIO === 'error') throw new Error('mock vitals error scenario');
    if (VITALS_SCENARIO === 'loading') return new Promise(() => null as never);
    if (VITALS_SCENARIO === 'stale') {
      // Emit ONE real sample, then freeze (never resolve) so the provider's
      // lastUpdated stops advancing and its freshness check trips → 'stale'.
      if (staleEmitted) return new Promise(() => null as never);
      staleEmitted = true;
      current = nextVitals(current, Math.random);
      return current;
    }
    current = nextVitals(current, Math.random);
    return current;
  },
};
