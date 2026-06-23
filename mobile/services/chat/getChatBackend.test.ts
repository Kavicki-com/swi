jest.mock('../../lib/featureFlags', () => ({ AUTH_BACKEND: 'mock' }));
jest.mock('aws-amplify/data', () => ({ generateClient: () => ({}) }));

import { getChatBackend } from './getChatBackend';
import { mockChatBackend } from './mockChatBackend';

describe('getChatBackend', () => {
  it('retorna o backend mock quando AUTH_BACKEND=mock (default)', () => {
    expect(getChatBackend()).toBe(mockChatBackend);
  });
});
