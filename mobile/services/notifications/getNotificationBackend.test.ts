jest.mock('../../lib/featureFlags', () => ({ AUTH_BACKEND: 'mock' }));
jest.mock('aws-amplify/data', () => ({ generateClient: () => ({}) }));

import { getNotificationBackend } from './getNotificationBackend';
import { mockNotificationBackend } from './mockNotificationBackend';

describe('getNotificationBackend', () => {
  it('retorna o backend mock quando AUTH_BACKEND=mock (default)', () => {
    expect(getNotificationBackend()).toBe(mockNotificationBackend);
  });
});
