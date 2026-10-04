import type { CamerasBackend } from './types';
import { DATA_BACKEND } from '../../lib/featureFlags';
import { apiCamerasBackend } from './apiCamerasBackend';
import { mockCamerasBackend } from './mockCamerasBackend';

// Honra DATA_BACKEND como os demais domínios (mock = sem rede).
export function getCamerasBackend(): CamerasBackend {
  return DATA_BACKEND === 'api' ? apiCamerasBackend : mockCamerasBackend;
}
