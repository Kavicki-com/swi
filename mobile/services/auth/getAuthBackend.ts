import { DATA_BACKEND } from '../../lib/featureFlags';
import type { AuthBackend } from './types';
import { mockAuthBackend } from './mockAuthBackend';
import { apiAuthBackend } from './apiAuthBackend';

export function getAuthBackend(): AuthBackend {
  return DATA_BACKEND === 'amplify' ? apiAuthBackend : mockAuthBackend;
}
