import { BASELINE_VITALS, nextVitals } from './simulator';

const seq = (vals: number[]) => { let i = 0; return () => vals[i++ % vals.length]; };

it('keeps every metric within sane bounds after many steps', () => {
  let v = BASELINE_VITALS;
  const rng = seq([0, 0.25, 0.5, 0.75, 0.999]);
  for (let i = 0; i < 500; i++) v = nextVitals(v, rng);
  expect(v.heartRate).toBeGreaterThanOrEqual(40);
  expect(v.heartRate).toBeLessThanOrEqual(140);
  expect(v.oxygenation).toBeGreaterThanOrEqual(80);
  expect(v.oxygenation).toBeLessThanOrEqual(100);
  expect(v.fatiguePct).toBeGreaterThanOrEqual(0);
  expect(v.fatiguePct).toBeLessThanOrEqual(100);
});
