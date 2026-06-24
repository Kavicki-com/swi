jest.mock('../../lib/featureFlags', () => ({ DATA_BACKEND: 'mock' }));
// Stub aws-amplify/auth: getAuthBackend statically imports amplifyAuthBackend
// (needed so a runtime flag flip works), which would otherwise pull in
// @aws-amplify/core's .native build → requires @aws-amplify/react-native, a
// native-only peer absent in this typecheck/test env. The selector never
// touches the amplify path, so an empty stub is faithful.
jest.mock('aws-amplify/auth', () => ({}));
import { getAuthBackend } from './getAuthBackend';
import { mockAuthBackend } from './mockAuthBackend';

it('returns the mock backend when the flag is mock', () => {
  expect(getAuthBackend()).toBe(mockAuthBackend);
});
