import { VITALS_SCENARIO } from '../../lib/featureFlags';
import type { Vitals, VitalsBackend } from './types';
import { BASELINE_VITALS, nextVitals } from './simulator';

let current: Vitals = BASELINE_VITALS;

export const mockVitalsBackend: VitalsBackend = {
  async getCurrent() {
    if (VITALS_SCENARIO === 'empty') return null;
    if (VITALS_SCENARIO === 'error') throw new Error('mock vitals error scenario');
    if (VITALS_SCENARIO === 'loading') return new Promise(() => null as never);
    current = nextVitals(current, Math.random);
    return current;
  },
};
