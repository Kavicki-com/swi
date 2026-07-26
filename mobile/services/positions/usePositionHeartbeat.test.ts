// getPositionsBackend cai no mock com DATA_BACKEND default — o hook exercita o
// mockPositionsBackend (log em memória), sem rede. Espelha useTelemetrySampler.test.
import { createElement, type ComponentType } from 'react';
// react-test-renderer ships no type declarations — tipa localmente (mesma nota
// do useTelemetrySampler.test.ts).
const TestRenderer: {
  create: (el: unknown) => { unmount: () => void };
  act: (cb: () => void | Promise<void>) => void | Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require('react-test-renderer');
const act = TestRenderer.act;
import { usePositionHeartbeat } from './usePositionHeartbeat';
import { mockHeartbeatLog } from './mockPositionsBackend';

function Harness({ getCoords }: { getCoords: () => [number, number] | null }) {
  usePositionHeartbeat(getCoords, { intervalMs: 1000 });
  return null;
}

beforeEach(() => {
  mockHeartbeatLog.length = 0;
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('usePositionHeartbeat', () => {
  it('posta lat/lng do getter a cada intervalo (ordem lat,lng — nunca trocada)', async () => {
    const el = createElement(Harness as ComponentType<any>, { getCoords: () => [-46.63, -23.55] });
    let root!: { unmount: () => void };
    await act(async () => { root = TestRenderer.create(el); });
    await act(async () => { jest.advanceTimersByTime(3000); });
    expect(mockHeartbeatLog.length).toBeGreaterThanOrEqual(3)
    // getCoords devolve [lng, lat] (convenção GeoJSON); o heartbeat é (lat, lng).
    expect(mockHeartbeatLog[0]).toEqual({ lat: -23.55, lng: -46.63 });
    await act(async () => { root.unmount(); });
  });

  it('coords null (sem fix ainda) → não posta; unmount para o relógio', async () => {
    const el = createElement(Harness as ComponentType<any>, { getCoords: () => null });
    let root!: { unmount: () => void };
    await act(async () => { root = TestRenderer.create(el); });
    await act(async () => { jest.advanceTimersByTime(3000); });
    expect(mockHeartbeatLog.length).toBe(0);
    await act(async () => { root.unmount(); });
    await act(async () => { jest.advanceTimersByTime(3000); });
    expect(mockHeartbeatLog.length).toBe(0);
  });
});
