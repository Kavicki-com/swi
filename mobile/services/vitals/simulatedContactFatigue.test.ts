import { simulatedFatigueFor } from './simulatedContactFatigue';

describe('simulatedFatigueFor', () => {
  it('é estável: a mesma pessoa sempre rende o mesmo valor', () => {
    expect(simulatedFatigueFor('worker-a')).toEqual(simulatedFatigueFor('worker-a'));
  });

  it('varia entre pessoas (o bug era 62% pra TODO contato)', () => {
    const ids = ['worker-a', 'worker-b', 'worker-c', 'worker-d', 'worker-e'];
    const pcts = new Set(ids.map((id) => simulatedFatigueFor(id).pct));
    expect(pcts.size).toBeGreaterThan(1);
  });

  it('fica numa faixa plausível e o tempo restante acompanha a fadiga', () => {
    for (const id of ['worker-a', 'worker-b', 'worker-c']) {
      const { pct, etaMin } = simulatedFatigueFor(id);
      expect(pct).toBeGreaterThanOrEqual(20);
      expect(pct).toBeLessThanOrEqual(85);
      // quanto mais fadiga, menos tempo sobra
      expect(etaMin).toBe(Math.round((480 * (100 - pct)) / 100));
    }
  });

  it('sem id (contato não encontrado) não inventa fadiga', () => {
    expect(simulatedFatigueFor('')).toEqual({ pct: 0, etaMin: 480 });
  });
});
