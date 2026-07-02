import { resolveCoords } from './resolveCoords';
import { USER_LOCATION } from '../../lib/mapMockData';

it('uses gps coords when present', () => {
  expect(resolveCoords([-46.6, -23.5])).toEqual({ coords: [-46.6, -23.5], source: 'gps' });
});
it('falls back to USER_LOCATION when gps is null', () => {
  expect(resolveCoords(null)).toEqual({ coords: USER_LOCATION, source: 'fallback' });
});
