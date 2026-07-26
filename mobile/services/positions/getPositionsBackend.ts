import type { PositionsBackend } from './types';
import { DATA_BACKEND } from '../../lib/featureFlags';
import { apiPositionsBackend } from './apiPositionsBackend';
import { mockPositionsBackend } from './mockPositionsBackend';

// Honra DATA_BACKEND como os demais domínios (mock = no-op, sem rede).
export function getPositionsBackend(): PositionsBackend {
  return DATA_BACKEND === 'api' ? apiPositionsBackend : mockPositionsBackend;
}
