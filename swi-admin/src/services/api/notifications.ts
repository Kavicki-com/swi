// O "Solicitar Pausa" do detalhe do funcionário fala com POST
// /notifications/pause-request: o backend valida org + role e enfileira a
// notificação de journey pro worker (aparece no app dele).
//
// O sino lê as notificações do próprio admin: GET /notifications (até 200, mais
// nova primeiro) e as duas marcações de lida. O mesmo formato chega pelo socket
// no evento `notification`.
import type { ServiceResponse } from '@/services/types'
import { apiFetch } from './http'

export type NotificationDomain =
  | 'weather'
  | 'chat'
  | 'reports'
  | 'journey'
  | 'faq'
  | 'evacuation'
  | 'health'

export type NotificationDto = {
  id: string
  title: string
  /** O servidor manda texto vazio quando a notificação não tem corpo. */
  body: string
  domain: NotificationDomain
  /** Na de saúde é o id da condição, que nenhuma rota leva ao funcionário. */
  targetId: string | null
  read: boolean
  createdAt: string
}

async function call<T>(work: () => Promise<T>, fallback: string): Promise<ServiceResponse<T>> {
  try {
    return { data: await work(), error: null }
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : fallback } }
  }
}

export const notificationsApi = {
  list: (): Promise<ServiceResponse<NotificationDto[]>> =>
    call(async () => {
      const rows = await apiFetch<unknown>('/notifications')
      // Corpo que não é lista (o apiFetch devolve {} quando o corpo não é JSON)
      // não pode virar "nenhuma notificação".
      if (!Array.isArray(rows)) throw new Error('Resposta inesperada das notificações')
      return rows as NotificationDto[]
    }, 'Falha ao carregar as notificações'),

  markRead: (id: string): Promise<ServiceResponse<null>> =>
    call(async () => {
      await apiFetch<unknown>(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' })
      return null
    }, 'Falha ao marcar a notificação como lida'),

  markAllRead: (): Promise<ServiceResponse<null>> =>
    call(async () => {
      await apiFetch<unknown>('/notifications/read-all', { method: 'POST' })
      return null
    }, 'Falha ao marcar as notificações como lidas'),

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
