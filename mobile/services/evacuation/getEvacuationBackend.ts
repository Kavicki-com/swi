import type { EvacuationBackend } from './types';
import { mockEvacuationBackend } from './mockEvacuationBackend';

// Pinado em mock até a fatia Evacuação ligar o apiEvacuationBackend
// (rodada: docs/plans/2026-07-02-swi-backend-dominios-nao-saude-design.md).
export function getEvacuationBackend(): EvacuationBackend {
  return mockEvacuationBackend;
}
