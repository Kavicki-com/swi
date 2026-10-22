import { mockEvacuationBackend } from './mockEvacuationBackend';
jest.mock('../../lib/featureFlags', () => ({ EVACUATION_SCENARIO: 'normal' }));

describe('mockEvacuationBackend (scenario=normal)', () => {
  it('devolve a rota de demonstracao, com origem e destino coerentes com o tracado', async () => {
    const r = await mockEvacuationBackend.getRoute(null);
    expect(r.waypoints.length).toBeGreaterThanOrEqual(2);
    expect(r.waypoints[0]).toEqual(r.origin);
    expect(r.waypoints[r.waypoints.length - 1]).toEqual(r.destination);
    expect(r.durationSec).toBeGreaterThan(0);
    expect(r.distanceM).toBeGreaterThan(0);
    // Rota de demonstracao e tracado, nao reta de emergencia.
    expect(r.approximate).toBe(false);
  });

  it('com a posicao do GPS a rota sai de onde a pessoa esta', async () => {
    const aqui: [number, number] = [-46.64, -23.56];
    const r = await mockEvacuationBackend.getRoute(aqui);
    expect(r.origin).toEqual(aqui);
    expect(r.waypoints[0]).toEqual(aqui);
  });
});
