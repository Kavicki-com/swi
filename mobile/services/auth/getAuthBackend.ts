import { AUTH_BACKEND } from '../../lib/featureFlags';
import type { AuthBackend } from './types';
import { mockAuthBackend } from './mockAuthBackend';
import { apiAuthBackend } from './apiAuthBackend';

export function getAuthBackend(): AuthBackend {
  return AUTH_BACKEND === 'api' ? apiAuthBackend : mockAuthBackend;
}
