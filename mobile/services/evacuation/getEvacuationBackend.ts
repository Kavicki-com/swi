import type { EvacuationBackend } from './types';
import { DATA_BACKEND } from '../../lib/featureFlags';
import { apiEvacuationBackend } from './apiEvacuationBackend';
import { mockEvacuationBackend } from './mockEvacuationBackend';

// Fatia Evacuação ligada: honra DATA_BACKEND (mock permanece p/ design review pixel-exato).
export function getEvacuationBackend(): EvacuationBackend {
  return DATA_BACKEND === 'api' ? apiEvacuationBackend : mockEvacuationBackend;
}
