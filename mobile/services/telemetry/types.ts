import type { Vitals } from '../vitals/types';
export interface VitalsTelemetry extends Vitals { workerId: string; recordedAt: string; expiresAt: number; status: 'good' | 'alert' | 'low'; }
export interface LocationTelemetry { workerId: string; recordedAt: string; lat: number; lng: number; accuracy?: number; expiresAt: number; }
export interface TelemetrySink {
  uploadVitals(s: VitalsTelemetry): Promise<void>;
  uploadLocation(s: LocationTelemetry): Promise<void>;
}
