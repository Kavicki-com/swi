import { generateClient } from 'aws-amplify/data';
import type { Vitals, VitalsBackend } from './types';

const client = generateClient();

export const amplifyVitalsBackend: VitalsBackend = {
  async getCurrent() {
    const { data } = await (client as any).models.VitalsSample.list({ limit: 1 });
    const s = data?.[0];
    if (!s) return null;
    return {
      heartRate: s.heartRate, bloodPressureSys: s.bloodPressureSys, bloodPressureDia: s.bloodPressureDia,
      oxygenation: s.oxygenation, caloriesPerHour: s.caloriesPerHour, steps: s.steps,
      distanceKm: s.distanceKm, effortPct: s.effortPct, fatiguePct: s.fatiguePct,
      fatigueEtaMin: s.fatigueEtaMin,
    } as Vitals;
  },
};
