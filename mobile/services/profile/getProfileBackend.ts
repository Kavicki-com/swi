import type { ProfileBackend } from './types';
import { mockProfileBackend } from './mockProfileBackend';

// Pinado em mock até a fatia Perfil ligar o apiProfileBackend
// (rodada: docs/plans/2026-07-02-swi-backend-dominios-nao-saude-design.md).
export function getProfileBackend(): ProfileBackend {
  return mockProfileBackend;
}
