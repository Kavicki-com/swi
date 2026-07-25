// Posições ao vivo dos workers (GET /positions, ADMIN org-scoped no backend).
// Fonte REAL: heartbeat do app mobile (em dev, o simulador SIM_POSITIONS anda
// pelos mesmos endpoints). Substitui o buildMockMapMarkers dos mapas.
import type { MockResponse } from '@/services/mockApi/types'
import type { DashboardMapMarker } from './dashboard'
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

// Borda do pino deriva de VITAIS (smartband) — até lá, neutro 'good'. Posição
// é real; status de saúde não existe ainda, e fingir variação aqui mentiria.
export function toDashboardMarker(dto: PositionMarkerDto): DashboardMapMarker {
  return {
    id: dto.id,
    name: dto.name,
    lat: dto.lat,
    lng: dto.lng,
    status: 'good',
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
