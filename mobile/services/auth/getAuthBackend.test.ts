jest.mock('../../lib/featureFlags', () => ({ DATA_BACKEND: 'mock' }));
// Stub expo-secure-store: getAuthBackend statically imports apiAuthBackend
// (needed so a runtime flag flip works), which pulls in expo-secure-store, a
// native module. The selector never touches the api path when the flag is
// 'mock', so an empty stub is faithful.
jest.mock('expo-secure-store', () => ({}));
import { getAuthBackend } from './getAuthBackend';
import { mockAuthBackend } from './mockAuthBackend';

it('returns the mock backend when the flag is mock', () => {
  expect(getAuthBackend()).toBe(mockAuthBackend);
});
