import { AUTH_BACKEND } from '../../lib/featureFlags';
import type { EvacuationBackend } from './types';
import { mockEvacuationBackend } from './mockEvacuationBackend';
import { amplifyEvacuationBackend } from './amplifyEvacuationBackend';

export function getEvacuationBackend(): EvacuationBackend {
  return AUTH_BACKEND === 'amplify' ? amplifyEvacuationBackend : mockEvacuationBackend;
}
