// Resgates (ticket 6.6), a partir de Alertas. Despachar um socorrista para um
// ferido grava o resgate no backend, que pausa a jornada do socorrista e o
// notifica. O histórico lista os resgates em andamento e encerrados. As datas
// chegam como ISO (JSON) e ficam string aqui.
import { apiFetch } from './http'

export type RescueStatus = 'dispatched' | 'arrived' | 'ended'

export type RescuePerson = { id: string; name: string }

export type Rescue = {
  id: string
  number: number
  status: RescueStatus
  startedAt: string
  arrivedAt: string | null
  endedAt: string | null
  injured: RescuePerson
  rescuer: RescuePerson
}

export const rescuesApi = {
  list: () => apiFetch<Rescue[]>('/alerts/rescues'),

  // O ferido vai no caminho; o socorrista escolhido, no corpo.
  dispatch: (injuredId: string, rescuerId: string) =>
    apiFetch<Rescue>(`/alerts/${injuredId}/rescue`, {
      method: 'POST',
      body: JSON.stringify({ rescuerId }),
    }),

  arrive: (id: string) => apiFetch<Rescue>(`/alerts/rescues/${id}/arrive`, { method: 'POST' }),

  end: (id: string) => apiFetch<Rescue>(`/alerts/rescues/${id}/end`, { method: 'POST' }),
}
