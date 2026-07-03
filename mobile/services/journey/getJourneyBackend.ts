import { DATA_BACKEND } from '../../lib/featureFlags';
import type { JourneyBackend } from './types';
import { mockJourneyBackend } from './mockJourneyBackend';
import { apiJourneyBackend } from './apiJourneyBackend';

// Fatia Jornada migrada: honra a flag DATA_BACKEND (igual getReportsBackend).
export function getJourneyBackend(): JourneyBackend {
  return DATA_BACKEND === 'api' ? apiJourneyBackend : mockJourneyBackend;
}
