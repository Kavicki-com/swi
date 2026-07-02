jest.mock('../../lib/featureFlags', () => ({ DATA_BACKEND: 'mock', EVACUATION_SCENARIO: 'normal' }));
jest.mock('aws-amplify/data', () => ({ generateClient: () => ({}) }));

import { getEvacuationBackend } from './getEvacuationBackend';
import { mockEvacuationBackend } from './mockEvacuationBackend';

describe('getEvacuationBackend', () => {
  it('retorna o backend mock quando DATA_BACKEND=mock (default)', () => {
    expect(getEvacuationBackend()).toBe(mockEvacuationBackend);
  });
});
