// Posições ao vivo dos workers (GET /positions, ADMIN org-scoped no backend).
// Fonte REAL: heartbeat do app mobile (em dev, o simulador SIM_POSITIONS anda
// pelos mesmos endpoints). Substitui o buildMockMapMarkers dos mapas.
import type { ServiceResponse } from '@/services/types'
import type { DashboardMapMarker } from './dashboard'
import type { AdminWorkerEntry, AdminWorkersTelemetry } from './telemetry'
import { healthStatusFrom } from '@/services/vitals/healthStatus'
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

/**
 * A posição vem do heartbeat e não sabe nada de saúde: o pino nasce neutro e
 * só ganha cor quando a telemetria do funcionário chega (withHealthStatus).
 * Verde por padrão afirmaria um estado que ninguém mediu.
 */
export function toDashboardMarker(dto: PositionMarkerDto): DashboardMapMarker {
  return {
    id: dto.id,
    name: dto.name,
    lat: dto.lat,
    lng: dto.lng,
    status: 'offline',
    avatarUri: dto.avatar,
    recordedAt: dto.recordedAt,
  }
}

/**
 * Cor do pino pela régua única de estado de saúde (healthStatusFrom): as
 * condições abertas no backend decidem, e sem leitura o pino fica neutro.
 */
export function markerStatusFor(entry: AdminWorkerEntry | undefined): DashboardMapMarker['status'] {
  const status = healthStatusFrom(entry?.telemetry ?? null)
  // O pino chama de offline o que a régua chama de desconhecido.
  return status === 'unknown' ? 'offline' : status
}

/** Pinta cada pino com o estado do seu funcionário; a posição não muda. */
export function withHealthStatus(
  markers: ReadonlyArray<DashboardMapMarker>,
  telemetry: AdminWorkersTelemetry | null,
): DashboardMapMarker[] {
  const byId = new Map((telemetry?.workers ?? []).map((e) => [e.worker.id, e]))
  return markers.map((m) => ({ ...m, status: markerStatusFor(byId.get(m.id)) }))
}

export const positionsApi = {
  // Envelope (nunca lança): falha de posições degrada o mapa pra vazio sem
  // derrubar a página — mesmo contrato das outras fachadas envelope.
  list: async (): Promise<ServiceResponse<DashboardMapMarker[]>> => {
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
