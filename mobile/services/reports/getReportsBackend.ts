import { DATA_BACKEND } from '../../lib/featureFlags';
import type { ReportsBackend } from './types';
import { mockReportsBackend } from './mockReportsBackend';
import { apiReportsBackend } from './apiReportsBackend';

// Fatia Relatórios migrada: honra a flag DATA_BACKEND (igual getProfileBackend).
export function getReportsBackend(): ReportsBackend {
  return DATA_BACKEND === 'api' ? apiReportsBackend : mockReportsBackend;
}
