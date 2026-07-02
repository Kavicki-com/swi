import type { TelemetrySink } from './types';
import { mockTelemetrySink } from './mockTelemetrySink';

// SAÚDE: pinado em mock ATÉ A SMARTBAND EXISTIR (decisão 2026-06-22/2026-07-02);
// ignora DATA_BACKEND de propósito — não ligar na rodada não-saúde.
export function getTelemetrySink(): TelemetrySink {
  return mockTelemetrySink;
}
