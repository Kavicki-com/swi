import { useEffect, useRef } from 'react';
import type { Vitals } from '../vitals/types';
import { deriveStatus } from '../vitals/deriveStatus';
import { downsample, shouldFlush } from '../../lib/telemetry/batch';
import { getTelemetrySink } from './getTelemetrySink';
import type { LocationTelemetry, VitalsTelemetry } from './types';

// 7-day retention. expiresAt is epoch SECONDS (DynamoDB TTL contract), never ms.
const TTL_SEC = 7 * 24 * 3600;
const DEFAULT_INTERVAL_MS = 60_000;
// Flush thresholds (shouldFlush trips on whichever comes first). At the default
// 60s interval the AGE trigger dominates (~5 min / ~10 samples); MAX_BATCH is
// the safety cap that dominates at faster intervals.
const MAX_BATCH = 20;
const MAX_AGE_MS = 5 * 60_000;

/** Epoch seconds for the TTL field. DynamoDB TTL requires seconds, not ms. */
export function ttlEpochSec(nowMs: number): number {
  return Math.floor(nowMs / 1000) + TTL_SEC;
}

/** Pure: assemble a VitalsTelemetry from a live sample. status is good|alert|low
 *  (deriveStatus only yields 'unknown' for null, which the caller excludes). */
export function buildVitalsSample(vitals: Vitals, workerId: string, nowMs: number): VitalsTelemetry {
  const status = deriveStatus(vitals);
  return {
    ...vitals,
    workerId,
    recordedAt: new Date(nowMs).toISOString(),
    expiresAt: ttlEpochSec(nowMs),
    status: status === 'unknown' ? 'good' : status,
  };
}

/** Pure: assemble a LocationTelemetry from [lng, lat] coords. */
export function buildLocationSample(coords: [number, number], workerId: string, nowMs: number): LocationTelemetry {
  return {
    workerId,
    recordedAt: new Date(nowMs).toISOString(),
    lng: coords[0],
    lat: coords[1],
    expiresAt: ttlEpochSec(nowMs),
  };
}

type Buffered =
  | { kind: 'vitals'; sample: VitalsTelemetry; recordedAt: number }
  | { kind: 'location'; sample: LocationTelemetry; recordedAt: number };

export function useTelemetrySampler(
  getVitals: () => Vitals | null,
  getCoords: () => [number, number] | null,
  opts?: { intervalMs?: number; workerId?: string },
): void {
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const workerId = opts?.workerId ?? 'self';

  // Keep the latest getters/config in refs so the interval effect stays stable
  // (mount-once) and always reads current values.
  const getVitalsRef = useRef(getVitals);
  const getCoordsRef = useRef(getCoords);
  const workerIdRef = useRef(workerId);
  getVitalsRef.current = getVitals;
  getCoordsRef.current = getCoords;
  workerIdRef.current = workerId;

  useEffect(() => {
    const sink = getTelemetrySink();
    const buffer: Buffered[] = [];

    const flush = async () => {
      const vitals = downsample(
        buffer.filter((b): b is Extract<Buffered, { kind: 'vitals' }> => b.kind === 'vitals'),
        intervalMs,
      );
      const location = downsample(
        buffer.filter((b): b is Extract<Buffered, { kind: 'location' }> => b.kind === 'location'),
        intervalMs,
      );
      buffer.length = 0;
      await Promise.all([
        ...vitals.map((b) => sink.uploadVitals(b.sample)),
        ...location.map((b) => sink.uploadLocation(b.sample)),
      ]);
    };

    const tick = () => {
      const now = Date.now();
      const vitals = getVitalsRef.current();
      const coords = getCoordsRef.current();
      if (vitals) buffer.push({ kind: 'vitals', sample: buildVitalsSample(vitals, workerIdRef.current, now), recordedAt: now });
      if (coords) buffer.push({ kind: 'location', sample: buildLocationSample(coords, workerIdRef.current, now), recordedAt: now });

      const oldestTs = buffer.length > 0 ? buffer[0].recordedAt : null;
      if (shouldFlush(buffer.length, oldestTs, now, MAX_BATCH, MAX_AGE_MS)) {
        void flush();
      }
    };

    const id = setInterval(tick, intervalMs);
    // Teardown stops new ticks but intentionally does NOT await/cancel an
    // in-flight flush() — telemetry upload is fire-and-forget.
    return () => clearInterval(id);
  }, [intervalMs]);
}
