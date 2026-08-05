import { mockEvacuationBackend } from './mockEvacuationBackend';
import { SITE_ROUTE } from './types';
jest.mock('../../lib/featureFlags', () => ({ EVACUATION_SCENARIO: 'normal' }));

describe('mockEvacuationBackend (scenario=normal)', () => {
  it('devolve a rota canned começando na origem e terminando no destino do site', async () => {
    const r = await mockEvacuationBackend.getRoute();
    expect(r.waypoints.length).toBeGreaterThanOrEqual(2);
    expect(r.waypoints[0]).toEqual(SITE_ROUTE.origin);
    expect(r.waypoints[r.waypoints.length - 1]).toEqual(SITE_ROUTE.destination);
    expect(r.durationSec).toBeGreaterThan(0);
    expect(r.distanceM).toBeGreaterThan(0);
  });
});
