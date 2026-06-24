import { DATA_BACKEND } from '../../lib/featureFlags';
import type { ReportsBackend } from './types';
import { mockReportsBackend } from './mockReportsBackend';
import { amplifyReportsBackend } from './amplifyReportsBackend';

export function getReportsBackend(): ReportsBackend {
  return DATA_BACKEND === 'amplify' ? amplifyReportsBackend : mockReportsBackend;
}
