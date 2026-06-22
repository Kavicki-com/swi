import { computePhase } from './phase';

const STALE = 120000;
it('no value yet, not errored -> loading', () => {
  expect(computePhase({ lastValue: undefined, lastUpdated: null, now: 0, errored: false, staleMs: STALE })).toBe('loading');
});
it('explicit null value -> empty', () => {
  expect(computePhase({ lastValue: null, lastUpdated: 1000, now: 1000, errored: false, staleMs: STALE })).toBe('empty');
});
it('errored -> error', () => {
  expect(computePhase({ lastValue: undefined, lastUpdated: null, now: 0, errored: true, staleMs: STALE })).toBe('error');
});
it('fresh value -> ready', () => {
  expect(computePhase({ lastValue: { } as any, lastUpdated: 1000, now: 1000, errored: false, staleMs: STALE })).toBe('ready');
});
it('old value -> stale', () => {
  expect(computePhase({ lastValue: { } as any, lastUpdated: 0, now: STALE + 1, errored: false, staleMs: STALE })).toBe('stale');
});
