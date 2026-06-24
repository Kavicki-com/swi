jest.mock('../../lib/featureFlags', () => ({ AUTH_BACKEND: 'mock', EVACUATION_SCENARIO: 'normal' }));
jest.mock('aws-amplify/data', () => ({ generateClient: () => ({}) }));

import { getEvacuationBackend } from './getEvacuationBackend';
import { mockEvacuationBackend } from './mockEvacuationBackend';

describe('getEvacuationBackend', () => {
  it('retorna o backend mock quando AUTH_BACKEND=mock (default)', () => {
    expect(getEvacuationBackend()).toBe(mockEvacuationBackend);
  });
});
