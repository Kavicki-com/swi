import { DATA_BACKEND } from '../../lib/featureFlags';
import type { ProfileBackend } from './types';
import { mockProfileBackend } from './mockProfileBackend';
import { amplifyProfileBackend } from './amplifyProfileBackend';

export function getProfileBackend(): ProfileBackend {
  return DATA_BACKEND === 'amplify' ? amplifyProfileBackend : mockProfileBackend;
}
