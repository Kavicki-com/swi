import { downsample, shouldFlush, aggregate } from './batch';

describe('downsample', () => {
  it('keeps at most one sample per intervalMs window', () => {
    const samples = [
      { recordedAt: 0 },
      { recordedAt: 500 },
      { recordedAt: 1000 },
      { recordedAt: 1500 },
    ];
    const kept = downsample(samples, 1000);
    expect(kept).toEqual([{ recordedAt: 0 }, { recordedAt: 1000 }]);
  });

  it('sorts by recordedAt before windowing (earliest wins per window)', () => {
    const samples = [{ recordedAt: 1500 }, { recordedAt: 0 }, { recordedAt: 500 }];
    expect(downsample(samples, 1000)).toEqual([{ recordedAt: 0 }, { recordedAt: 1500 }]);
  });

  it('returns [] for no samples', () => {
    expect(downsample([], 1000)).toEqual([]);
  });
});

describe('shouldFlush', () => {
  it('flushes when bufferLen >= maxSize', () => {
    expect(shouldFlush(20, null, 0, 20, 300000)).toBe(true);
  });
  it('flushes when oldestTs set and now-oldestTs >= maxAgeMs', () => {
    expect(shouldFlush(1, 0, 300000, 20, 300000)).toBe(true);
  });
  it('does not flush when under size and oldestTs is null', () => {
    expect(shouldFlush(0, null, 999999, 20, 300000)).toBe(false);
  });
  it('does not flush when under size and not yet aged out', () => {
    expect(shouldFlush(5, 0, 299999, 20, 300000)).toBe(false);
  });
});

describe('aggregate', () => {
  it('computes avg/min/max', () => {
    expect(aggregate([1, 2, 3])).toEqual({ avg: 2, min: 1, max: 3 });
  });
  it('returns zeros for empty input', () => {
    expect(aggregate([])).toEqual({ avg: 0, min: 0, max: 0 });
  });
});
