import { AUTH_BACKEND } from '../../lib/featureFlags';
import type { VitalsBackend } from './types';
import { mockVitalsBackend } from './mockVitalsBackend';
import { amplifyVitalsBackend } from './amplifyVitalsBackend';

export function getVitalsBackend(): VitalsBackend {
  return AUTH_BACKEND === 'amplify' ? amplifyVitalsBackend : mockVitalsBackend;
}
