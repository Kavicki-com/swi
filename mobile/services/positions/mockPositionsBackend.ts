import type { PositionsBackend } from './types';

// Caminho demo: nenhum backend pra receber posição — o heartbeat é no-op.
// O log em memória existe SÓ pros testes do hook observarem as chamadas
// (mesmo padrão do mockTelemetrySink).
export const mockHeartbeatLog: { lat: number; lng: number }[] = [];

export const mockPositionsBackend: PositionsBackend = {
  async heartbeat(lat: number, lng: number): Promise<void> {
    mockHeartbeatLog.push({ lat, lng });
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
