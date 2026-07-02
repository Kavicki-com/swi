// Mirrors services/auth/getAuthBackend.test.ts. The flag is forced to 'mock';
// aws-amplify/data is stubbed because getProfileBackend statically imports
// amplifyProfileBackend (which calls generateClient() at module load), and the
// real module drags in the native-only @aws-amplify/react-native peer that is
// absent in the jest-expo env. The mock-flag path never touches the amplify
// backend at runtime.
jest.mock('../../lib/featureFlags', () => ({ DATA_BACKEND: 'mock' }));
jest.mock('aws-amplify/data', () => ({ generateClient: () => ({}) }));

import { getProfileBackend } from './getProfileBackend';
import { mockProfileBackend } from './mockProfileBackend';

it('returns the mock backend when the flag is mock', () => {
  expect(getProfileBackend()).toBe(mockProfileBackend);
});
