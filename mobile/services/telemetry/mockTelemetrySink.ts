import type { TelemetrySink, VitalsTelemetry, LocationTelemetry } from './types';
export const mockTelemetryLog: { vitals: VitalsTelemetry[]; location: LocationTelemetry[] } = { vitals: [], location: [] };
export const mockTelemetrySink: TelemetrySink = {
  async uploadVitals(s) { mockTelemetryLog.vitals.push(s); },
  async uploadLocation(s) { mockTelemetryLog.location.push(s); },
};
