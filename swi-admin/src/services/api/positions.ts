// Posições ao vivo dos workers (GET /positions, ADMIN org-scoped no backend).
// Fonte REAL: heartbeat do app mobile (em dev, o simulador SIM_POSITIONS anda
// pelos mesmos endpoints). Substitui o buildMockMapMarkers dos mapas.
import type { MockResponse } from '@/services/mockApi/types'
import type { DashboardMapMarker } from './dashboard'
import { simulatedVitalsFor, type SimulatedTier } from '@/services/vitals/simulatedVitals'
import { apiFetch, ApiError } from './http'

// Shape do backend (PositionMarker em swi-backend/src/positions/positions.service.ts).
export type PositionMarkerDto = {
  id: string
  name: string
  lat: number
  lng: number
  sector: string | null
  avatar: string
  recordedAt: string
}

// Borda do pino ↔ tier dos vitais, o MESMO mapeamento do resto do app
// (rescue.ts). Ver nota de derivação abaixo.
const TIER_TO_STATUS: Record<SimulatedTier, DashboardMapMarker['status']> = {
  excelente: 'good',
  desgastado: 'alert',
  'alerta-fadiga': 'low',
}

/**
 * Posição é REAL (heartbeat); a borda de saúde vem do gerador SIMULADO comum
 * (Fase 3) — o mesmo que alimenta KPIs, monitoramento e triagem de socorro.
 *
 * Antes o status era `'good'` fixo: o mapa de alertas pintava os 9 pinos de
 * verde enquanto o dashboard, na mesma tela, dizia "5 desgastados / 2 em alerta
 * de fadiga" (QA 2026-07-26). Um pino verde sobre alguém em alerta é pior que
 * um pino neutro — é uma afirmação errada.
 *
 * O tier é estável por worker (hash do id, sem componente temporal), então o
 * pino não pisca de cor a cada tick do heartbeat.
 */
export function toDashboardMarker(dto: PositionMarkerDto): DashboardMapMarker {
  return {
    id: dto.id,
    name: dto.name,
    lat: dto.lat,
    lng: dto.lng,
    status: TIER_TO_STATUS[simulatedVitalsFor(dto.id, Date.now()).tier],
    avatarUri: dto.avatar,
  }
}

export const positionsApi = {
  // Envelope (nunca lança): falha de posições degrada o mapa pra vazio sem
  // derrubar a página — mesmo contrato das outras fachadas envelope.
  list: async (): Promise<MockResponse<DashboardMapMarker[]>> => {
    try {
      const rows = await apiFetch<PositionMarkerDto[]>('/positions')
      return { data: rows.map(toDashboardMarker), error: null }
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Não foi possível carregar as posições'
      return { data: null, error: { message } }
    }
  },
}
