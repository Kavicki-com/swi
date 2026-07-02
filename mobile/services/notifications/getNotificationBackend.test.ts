jest.mock('../../lib/featureFlags', () => ({ DATA_BACKEND: 'mock' }));
jest.mock('aws-amplify/data', () => ({ generateClient: () => ({}) }));

import { getNotificationBackend } from './getNotificationBackend';
import { mockNotificationBackend } from './mockNotificationBackend';

describe('getNotificationBackend', () => {
  it('retorna o backend mock quando DATA_BACKEND=mock (default)', () => {
    expect(getNotificationBackend()).toBe(mockNotificationBackend);
  });
});
