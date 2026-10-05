// Armazém do sino: liga o socket, lê a API e aplica as regras puras de
// notificationList. Sem React; o provider só liga e desliga e repassa os
// gatilhos de releitura (volta da conexão, volta da aba, abrir o sino).
import type { NotificationDto } from '@/services/api/notifications'
import type { ServiceResponse } from '@/services/types'
import {
  initialNotifications,
  withArrival,
  withFailure,
  withLocalRead,
  withReadSettled,
  withResponse,
  type NotificationsState,
} from './notificationList'

export interface NotificationsStoreDeps {
  api: {
    list(): Promise<ServiceResponse<NotificationDto[]>>
    markRead(id: string): Promise<ServiceResponse<null>>
    markAllRead(): Promise<ServiceResponse<null>>
  }
  subscribe(cb: (n: NotificationDto) => void): () => void
}

export interface NotificationsStore {
  getState(): NotificationsState
  subscribe(listener: () => void): () => void
  /** Assina o socket e faz a primeira leitura; o retorno desliga. */
  start(): () => void
  /** Relê. Pedida durante uma leitura, vira uma só, logo depois dela. */
  refresh(): void
  markRead(id: string): void
  markAllRead(): void
}

// Promessa que rejeita vira falha comum: sem isto a leitura ficaria "em voo"
// para sempre e nenhuma outra sairia.
const failed = <T>(): ServiceResponse<T> => ({
  data: null,
  error: { message: 'Falha ao falar com o servidor' },
})

export function createNotificationsStore(deps: NotificationsStoreDeps): NotificationsStore {
  let state = initialNotifications()
  const listeners = new Set<() => void>()
  // Cada ligação tem um número: resposta de uma ligação anterior (o StrictMode
  // liga, desliga e liga de novo) não toca no estado.
  let generation = 0
  let active = false
  let requests = 0
  let inFlight = false
  let again = false

  const set = (next: NotificationsState) => {
    if (next === state) return
    state = next
    for (const l of [...listeners]) l()
  }

  // A volta da aba e a volta da conexão chegam quase juntas: em vez de duas
  // leituras cruzadas, a segunda espera a primeira e sai uma vez só.
  const read = () => {
    if (!active) return
    if (inFlight) {
      again = true
      return
    }
    inFlight = true
    const gen = generation
    const request = ++requests
    const askedArrival = state.arrivalCount
    void deps.api
      .list()
      .catch(() => failed<NotificationDto[]>())
      .then((res) => {
        if (gen !== generation) return
        inFlight = false
        set(
          res.data
            ? withResponse(state, { request, askedArrival, items: res.data })
            : withFailure(state, request),
        )
        if (again) {
          again = false
          read()
        }
      })
  }

  const settle = (ids: string[], gen: number) => (res: ServiceResponse<null>) => {
    if (gen !== generation) return
    set(withReadSettled(state, ids, !res.error, requests))
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    start() {
      generation += 1
      active = true
      inFlight = false
      again = false
      const unsubscribe = deps.subscribe((dto) => set(withArrival(state, dto)))
      read()
      return () => {
        active = false
        generation += 1
        unsubscribe()
      }
    },
    refresh: read,
    markRead(id) {
      const item = state.items.find((n) => n.id === id)
      if (!item || item.read) return
      set(withLocalRead(state, [id]))
      void deps.api
        .markRead(id)
        .catch(() => failed<null>())
        .then(settle([id], generation))
    },
    markAllRead() {
      const ids = state.items.filter((n) => !n.read).map((n) => n.id)
      if (ids.length === 0) return
      set(withLocalRead(state, ids))
      void deps.api
        .markAllRead()
        .catch(() => failed<null>())
        .then(settle(ids, generation))
    },
  }
}
