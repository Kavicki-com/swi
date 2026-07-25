// Evacuação real (Fase 2 do realtime): dispatch/progresso/encerramento contra
// o backend Nest (/evacuations, ADMIN org-scoped). O ack é do worker (app
// mobile ou simulador dev) — o admin só observa o X/N subir.
import type { MockResponse } from '@/services/mockApi/types'
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
}

const asError = (err: unknown) => ({
  message: err instanceof ApiError ? err.message : 'Não foi possível falar com o servidor',
})

export const evacuationsApi = {
  // "Sem ativa" chega como 200 de corpo vazio → apiFetch entrega null, que
  // aqui é estado legítimo (data null + error null), não falha.
  active: async (): Promise<MockResponse<EvacuationProgressDto | null>> => {
    try {
      const dto = await apiFetch<EvacuationProgressDto | null>('/evacuations/active')
      return { data: dto?.id ? dto : null, error: null }
    } catch (err) {
      return { data: null, error: asError(err) }
    }
  },

  start: async (): Promise<MockResponse<EvacuationProgressDto>> => {
    try {
      const dto = await apiFetch<EvacuationProgressDto>('/evacuations', { method: 'POST' })
      return { data: dto, error: null }
    } catch (err) {
      return { data: null, error: asError(err) }
    }
  },

  end: async (id: string): Promise<MockResponse<null>> => {
    try {
      await apiFetch<null>(`/evacuations/${id}/end`, { method: 'POST' })
      return { data: null, error: null }
    } catch (err) {
      return { data: null, error: asError(err) }
    }
  },
}
