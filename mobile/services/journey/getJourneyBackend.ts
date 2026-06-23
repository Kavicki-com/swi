import { AUTH_BACKEND } from '../../lib/featureFlags';
import type { JourneyBackend } from './types';
import { mockJourneyBackend } from './mockJourneyBackend';
import { amplifyJourneyBackend } from './amplifyJourneyBackend';

export function getJourneyBackend(): JourneyBackend {
  return AUTH_BACKEND === 'amplify' ? amplifyJourneyBackend : mockJourneyBackend;
}
