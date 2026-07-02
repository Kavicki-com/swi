import type { ReportsBackend } from './types';
import { mockReportsBackend } from './mockReportsBackend';

// Pinado em mock até a fatia Relatórios ligar o apiReportsBackend
// (rodada: docs/plans/2026-07-02-swi-backend-dominios-nao-saude-design.md).
export function getReportsBackend(): ReportsBackend {
  return mockReportsBackend;
}
