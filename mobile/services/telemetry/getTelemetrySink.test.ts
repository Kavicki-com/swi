// Mirrors services/vitals/getVitalsBackend.test.ts. The flag is forced to
// 'mock'; aws-amplify/data is stubbed because getTelemetrySink statically
// imports amplifyTelemetrySink (which calls generateClient() at module load),
// and the real module drags in the native-only @aws-amplify/react-native peer
// that is absent in the jest-expo env. The mock-flag path never touches the
// amplify sink at runtime.
jest.mock('../../lib/featureFlags', () => ({ DATA_BACKEND: 'mock' }));
jest.mock('aws-amplify/data', () => ({ generateClient: () => ({}) }));

import { getTelemetrySink } from './getTelemetrySink';
import { mockTelemetrySink } from './mockTelemetrySink';

it('returns the mock sink when the flag is mock', () => {
  expect(getTelemetrySink()).toBe(mockTelemetrySink);
});
