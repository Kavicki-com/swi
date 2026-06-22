import { AUTH_BACKEND } from '../../lib/featureFlags';
import type { ProfileBackend } from './types';
import { mockProfileBackend } from './mockProfileBackend';
import { amplifyProfileBackend } from './amplifyProfileBackend';

export function getProfileBackend(): ProfileBackend {
  return AUTH_BACKEND === 'amplify' ? amplifyProfileBackend : mockProfileBackend;
}
