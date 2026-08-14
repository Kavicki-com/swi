import { RUNTIME_ENV } from '../../lib/featureFlags';
import type { TelemetrySink } from './types';
import { mockTelemetrySink } from './mockTelemetrySink';
import { noopTelemetrySink } from './noopTelemetrySink';

// SAÚDE: por decisão de produto, não há destino real para a telemetria
// enquanto a smartband não for integrada.
// Ignora DATA_BACKEND de propósito: a flag não liga um provedor que não existe.
//
// Em dev e teste as amostras vão para um log inspecionável, que é o que permite
// exercitar o amostrador. Fora deles seriam lixo acumulando na memória, então
// são descartadas explicitamente.
export function getTelemetrySink(): TelemetrySink {
  return RUNTIME_ENV.isDev || RUNTIME_ENV.isTest
    ? mockTelemetrySink
    : noopTelemetrySink;
}
