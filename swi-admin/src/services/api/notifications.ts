// QA F (2026-07-24): o "Solicitar Pausa" do detalhe do funcionário era toast
// fake. POST /notifications/pause-request — o backend valida org + role e
// enfileira a notificação de journey pro worker (aparece no app dele).
import type { ServiceResponse } from '@/services/types'
import { apiFetch } from './http'

export const notificationsApi = {
  requestPause: async (workerId: string): Promise<ServiceResponse<{ requested: true }>> => {
    try {
      await apiFetch<unknown>('/notifications/pause-request', {
        method: 'POST',
        body: JSON.stringify({ workerId }),
      })
      return { data: { requested: true }, error: null }
    } catch (e) {
      return {
        data: null,
        error: { message: e instanceof Error ? e.message : 'Falha ao solicitar a pausa' },
      }
    }
  },
}
