import { generateClient } from 'aws-amplify/data';
import type { TelemetrySink } from './types';

const client = generateClient();

export const amplifyTelemetrySink: TelemetrySink = {
  async uploadVitals(s) { await (client as any).models.VitalsSample.create(s); },
  async uploadLocation(s) { await (client as any).models.LocationSample.create(s); },
};
