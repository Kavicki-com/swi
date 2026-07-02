import { USER_LOCATION } from '../../lib/mapMockData';
import type { LocationSource } from './types';

/** Pure: choose GPS coords or the mock fallback. */
export function resolveCoords(gps: [number, number] | null): { coords: [number, number]; source: LocationSource } {
  return gps ? { coords: gps, source: 'gps' } : { coords: USER_LOCATION, source: 'fallback' };
}
