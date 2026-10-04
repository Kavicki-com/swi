import type { PositionsBackend } from './types';
import type { QueuedPoint } from './positionOutbox';

// Caminho demo: nenhum backend pra receber posição — o heartbeat é no-op.
// O log em memória existe SÓ pros testes do hook observarem as chamadas
// (mesmo padrão do mockTelemetrySink).
export const mockHeartbeatLog: { lat: number; lng: number }[] = [];
export const mockBatchLog: QueuedPoint[] = [];

export const mockPositionsBackend: PositionsBackend = {
  async heartbeat(lat: number, lng: number): Promise<void> {
    mockHeartbeatLog.push({ lat, lng });
  },
  // Nada a gravar: o lote "entra" inteiro, e a fila esvazia como na API.
  async sendBatch(points) {
    mockBatchLog.push(...points);
    return { recorded: points.length, ignored: 0 };
  },
  // Sem backend não há colega nem presença para mostrar: o mapa fica vazio em
  // vez de inventar gente.
  async listColleagues() {
    return [];
  },
  async heat() {
    const now = new Date().toISOString();
    return { cellSizeM: 50, from: now, to: now, cells: [] };
  },
};
