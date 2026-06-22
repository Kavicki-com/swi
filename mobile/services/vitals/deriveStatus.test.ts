import { deriveStatus } from './deriveStatus';
import { BASELINE_VITALS } from './simulator';

it('null vitals -> unknown (never fake good)', () => { expect(deriveStatus(null)).toBe('unknown'); });
it('baseline -> alert (fatigue 74)', () => { expect(deriveStatus(BASELINE_VITALS)).toBe('alert'); });
it('low oxygenation -> low', () => { expect(deriveStatus({ ...BASELINE_VITALS, fatiguePct: 10, oxygenation: 88 })).toBe('low'); });
it('healthy -> good', () => { expect(deriveStatus({ ...BASELINE_VITALS, fatiguePct: 20, oxygenation: 98, heartRate: 70 })).toBe('good'); });
