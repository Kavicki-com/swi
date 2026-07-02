import { DATA_BACKEND } from '../../lib/featureFlags';
import type { ProfileBackend } from './types';
import { mockProfileBackend } from './mockProfileBackend';
import { apiProfileBackend } from './apiProfileBackend';

export function getProfileBackend(): ProfileBackend {
  return DATA_BACKEND === 'api' ? apiProfileBackend : mockProfileBackend;
}
