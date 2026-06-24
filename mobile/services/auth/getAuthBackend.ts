import { DATA_BACKEND } from '../../lib/featureFlags';
import type { AuthBackend } from './types';
import { mockAuthBackend } from './mockAuthBackend';
import { amplifyAuthBackend } from './amplifyAuthBackend';

export function getAuthBackend(): AuthBackend {
  return DATA_BACKEND === 'amplify' ? amplifyAuthBackend : mockAuthBackend;
}
