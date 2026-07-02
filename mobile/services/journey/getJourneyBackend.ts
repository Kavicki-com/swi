import type { JourneyBackend } from './types';
import { mockJourneyBackend } from './mockJourneyBackend';

// Pinado em mock até a fatia Jornada ligar o apiJourneyBackend
// (rodada: docs/plans/2026-07-02-swi-backend-dominios-nao-saude-design.md).
export function getJourneyBackend(): JourneyBackend {
  return mockJourneyBackend;
}
