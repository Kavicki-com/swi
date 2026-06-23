jest.mock('../../lib/featureFlags', () => ({ AUTH_BACKEND: 'mock' }));
jest.mock('aws-amplify/data', () => ({ generateClient: () => ({}) }));

import { getJourneyBackend } from './getJourneyBackend';
import { mockJourneyBackend } from './mockJourneyBackend';

describe('getJourneyBackend', () => {
  it('retorna o backend mock quando AUTH_BACKEND=mock (default)', () => {
    expect(getJourneyBackend()).toBe(mockJourneyBackend);
  });
});
