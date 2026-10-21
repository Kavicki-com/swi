// Evacuação: dispatch/progresso/encerramento contra o backend Nest
// (/evacuations, ADMIN org-scoped). O ack é do worker (app mobile ou simulador
// dev), o admin só observa o X/N subir.
import type { ServiceResponse } from '@/services/types'
import type { AreaVertex } from '@/lib/evacuationArea'
import { apiFetch, ApiError } from './http'

export type EvacuationWorkerEntry = {
  id: string
  name: string
  acked: boolean
  ackAt: string | null
}

export type EvacuationProgressDto = {
  id: string
  status: 'ACTIVE' | 'ENDED'
  startedAt: string
  endedAt: string | null
  total: number
  acked: number
  workers: EvacuationWorkerEntry[]
  // Polígono da área demarcada ao iniciar (anel fechado [lng, lat]), ou null
  // quando a evacuação foi disparada sem recorte visual.
  area: AreaVertex[] | null
  // Ponto de encontro marcado ao iniciar ([lng, lat]), destino da rota de
  // evacuação. Null nas evacuações anteriores ao ponto obrigatório.
  musterPoint: AreaVertex | null
}

const asError = (err: unknown) => ({
  message: err instanceof ApiError ? err.message : 'Não foi possível falar com o servidor',
})

export const evacuationsApi = {
  // "Sem ativa" chega como 200 de corpo vazio → apiFetch entrega null, que
  // aqui é estado legítimo (data null + error null), não falha.
  active: async (): Promise<ServiceResponse<EvacuationProgressDto | null>> => {
    try {
      const dto = await apiFetch<EvacuationProgressDto | null>('/evacuations/active')
      return { data: dto?.id ? dto : null, error: null }
    } catch (err) {
      return { data: null, error: asError(err) }
    }
  },

  // `area` é o polígono [[lng,lat],...] desenhado no mapa ao iniciar e
  // `musterPoint` o ponto de encontro marcado no passo seguinte. Os dois são
  // obrigatórios: o backend recusa (400) o disparo sem o ponto, porque é dele
  // que sai a rota de evacuação.
  start: async (
    area: AreaVertex[],
    musterPoint: AreaVertex,
  ): Promise<ServiceResponse<EvacuationProgressDto>> => {
    try {
      const dto = await apiFetch<EvacuationProgressDto>('/evacuations', {
        method: 'POST',
        body: JSON.stringify({ area, musterPoint }),
      })
      return { data: dto, error: null }
    } catch (err) {
      return { data: null, error: asError(err) }
    }
  },

  end: async (id: string): Promise<ServiceResponse<null>> => {
    try {
      await apiFetch<null>(`/evacuations/${id}/end`, { method: 'POST' })
      return { data: null, error: null }
    } catch (err) {
      return { data: null, error: asError(err) }
    }
  },
}
