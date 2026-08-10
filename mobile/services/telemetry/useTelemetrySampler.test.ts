// getTelemetrySink está pinado em mock (carve-out saúde), então o hook só
// exercita o mockTelemetrySink aqui, sem stubs de featureFlags/aws.
import { createElement, type ComponentType } from 'react';
import {
  useTelemetrySampler, buildVitalsSample, buildLocationSample, ttlEpochSec,
} from './useTelemetrySampler';
import { mockTelemetryLog } from './mockTelemetrySink';
import type { Vitals } from '../vitals/types';
// react-test-renderer ships no type declarations and @types/react-test-renderer
// is not a project dep, type the two helpers we use locally to keep tsc clean
// without adding a dependency just for the test.
const TestRenderer: {
  create: (el: unknown) => { unmount: () => void };
  act: (cb: () => void | Promise<void>) => void | Promise<void>;
} = require('react-test-renderer');
const act = TestRenderer.act;

const VITALS: Vitals = {
  heartRate: 80, bloodPressureSys: 120, bloodPressureDia: 80, oxygenation: 98,
  caloriesPerHour: 300, steps: 1000, distanceKm: 1, effortPct: 40,
  fatiguePct: 20, fatigueEtaMin: 120,
};

beforeEach(() => {
  mockTelemetryLog.vitals.length = 0;
  mockTelemetryLog.location.length = 0;
});

describe('pure builders', () => {
  it('builds a VitalsTelemetry with epoch-SECONDS expiresAt and derived status', () => {
    const nowMs = 1_700_000_000_000; // 2023-11-14T...Z
    const s = buildVitalsSample(VITALS, 'w1', nowMs);
    expect(s.workerId).toBe('w1');
    expect(s.heartRate).toBe(80);
    expect(s.status).toBe('good');
    expect(s.recordedAt).toBe(new Date(nowMs).toISOString());
    // epoch seconds: ~1.7e9 (NOT ms ~1.7e12). 7d TTL = 604800s.
    expect(s.expiresAt).toBe(Math.floor(nowMs / 1000) + 7 * 24 * 3600);
    expect(s.expiresAt).toBeLessThan(2_000_000_000); // sanity: seconds, not ms
  });

  it('builds a LocationTelemetry from [lng, lat]', () => {
    const nowMs = 1_700_000_000_000;
    const s = buildLocationSample([-46.6, -23.5], 'w1', nowMs);
    expect(s).toMatchObject({ workerId: 'w1', lng: -46.6, lat: -23.5 });
    expect(s.expiresAt).toBe(ttlEpochSec(nowMs));
  });
});

describe('useTelemetrySampler (fake timers)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const Harness: ComponentType = () => {
    useTelemetrySampler(() => VITALS, () => [-46.6, -23.5], { intervalMs: 1000, workerId: 'w1' });
    return null;
  };

  it('flushes vitals + location samples after enough intervals', async () => {
    let renderer!: { unmount: () => void };
    act(() => { renderer = TestRenderer.create(createElement(Harness)); });

    // 20 ticks hits MAX_BATCH (vitals+location → 40 buffered ≥ 20). flush() runs.
    await act(async () => {
      for (let i = 0; i < 20; i++) jest.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockTelemetryLog.vitals.length).toBeGreaterThan(0);
    expect(mockTelemetryLog.location.length).toBeGreaterThan(0);
    expect(mockTelemetryLog.vitals[0].status).toBe('good');
    expect(mockTelemetryLog.vitals[0].expiresAt).toBeLessThan(2_000_000_000);

    act(() => { renderer.unmount(); });
  });
});
