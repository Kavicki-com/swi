// Mapa de calor real a partir do histórico de posições (GET /positions/heat,
// ADMIN, por empresa). O backend agrega a trilha em células e devolve só o
// peso de cada uma, nunca trilhas individuais.
import type { ServiceResponse } from '@/services/types'
import { apiFetch } from './http'

export type HeatCell = {
  lat: number
  lng: number
  /** Minutos distintos de funcionário na célula. */
  weight: number
}

export type HeatResponse = {
  cellSizeM: number
  /** ISO-8601 da janela efetivamente consultada. */
  from: string
  to: string
  /** Mais quentes primeiro. */
  cells: HeatCell[]
}

export type HeatQuery = {
  /** ISO-8601; sem janela o backend usa as últimas 24 horas. */
  from?: string
  to?: string
}

export const positionHeatApi = {
  heat: async (query: HeatQuery = {}): Promise<ServiceResponse<HeatResponse>> => {
    const params = new URLSearchParams()
    if (query.from) params.set('from', query.from)
    if (query.to) params.set('to', query.to)
    const qs = params.toString()
    try {
      const data = await apiFetch<HeatResponse>(`/positions/heat${qs ? `?${qs}` : ''}`)
      return { data, error: null }
    } catch (e) {
      return {
        data: null,
        error: { message: e instanceof Error ? e.message : 'Falha ao carregar o mapa de calor' },
      }
    }
  },
}
