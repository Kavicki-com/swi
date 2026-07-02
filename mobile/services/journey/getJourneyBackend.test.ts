jest.mock('../../lib/featureFlags', () => ({ DATA_BACKEND: 'mock' }));
jest.mock('aws-amplify/data', () => ({ generateClient: () => ({}) }));

import { getJourneyBackend } from './getJourneyBackend';
import { mockJourneyBackend } from './mockJourneyBackend';

describe('getJourneyBackend', () => {
  it('retorna o backend mock quando DATA_BACKEND=mock (default)', () => {
    expect(getJourneyBackend()).toBe(mockJourneyBackend);
  });
});
