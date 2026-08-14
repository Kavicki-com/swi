import type { TelemetrySink } from './types';

/**
 * Sink que descarta as amostras, e só isso.
 *
 * Não existe fonte de telemetria real enquanto a smartband não for integrada.
 * Fora de dev e teste, acumular as amostras num array seria vazamento de
 * memória sem nenhum
 * consumidor, e enfileirá-las para reenvio fingiria uma persistência que não
 * existe. Descartar é a única coisa honesta a fazer até haver hardware.
 */
export const noopTelemetrySink: TelemetrySink = {
  async uploadVitals() {},
  async uploadLocation() {},
};
