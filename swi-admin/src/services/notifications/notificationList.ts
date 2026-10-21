// Estado da lista do sino, sem React e sem rede: a leitura da API, o que chega
// pelo socket e as marcas de lida feitas aqui. Cada função devolve um estado
// novo.
//
// Duas leituras podem se cruzar com o socket. A regra: cada chegada pelo socket
// recebe um número; o pedido guarda o número do momento em que saiu; na
// resposta, o que chegou depois desse número e não veio nela fica, porque foi
// gravado depois da consulta. Resposta de um pedido mais velho que o último
// aplicado é descartada.
import type { NotificationDto } from '@/services/api/notifications'

/** O servidor devolve no máximo 200; a lista daqui segue o mesmo teto. */
export const NOTIFICATIONS_CAP = 200

export type NotificationsStatus = 'loading' | 'ready' | 'failed'

export type NotificationsState = {
  status: NotificationsStatus
  /** Mais nova primeiro, sem as de chat. */
  items: NotificationDto[]
  /**
   * Marcadas como lidas aqui. `null` enquanto o servidor não respondeu; depois
   * de confirmada, o número da última leitura já pedida naquele momento: uma
   * leitura até esse número pode ter saído antes da gravação e ainda dizer
   * "não lida", então a marca vale até chegar resposta de leitura mais nova.
   */
  pendingRead: ReadonlyMap<string, number | null>
  /**
   * Limpas aqui ("limpar todas"), com a mesma regra de `pendingRead`: ficam
   * fora de qualquer resposta até chegar leitura pedida depois da confirmação.
   */
  pendingClear: ReadonlyMap<string, number | null>
  /** Número de cada chegada pelo socket, por id. */
  arrivals: ReadonlyMap<string, number>
  arrivalCount: number
  /** Número do último pedido cuja resposta foi aplicada. */
  lastApplied: number
}

export type NotificationsResponse = {
  request: number
  /** `arrivalCount` no momento em que o pedido saiu. */
  askedArrival: number
  items: NotificationDto[]
}

export function initialNotifications(): NotificationsState {
  return {
    status: 'loading',
    items: [],
    pendingRead: new Map(),
    pendingClear: new Map(),
    arrivals: new Map(),
    arrivalCount: 0,
    lastApplied: 0,
  }
}

// O chat tem contador próprio na lateral, e ler a conversa não marca essa
// notificação como lida: no sino ela só faria o número crescer.
const belongsInBell = (n: NotificationDto) => n.domain !== 'chat'

const newestFirst = (a: NotificationDto, b: NotificationDto) =>
  Date.parse(b.createdAt) - Date.parse(a.createdAt)

const withPendingReads = (items: NotificationDto[], pending: ReadonlyMap<string, number | null>) =>
  items.map((n) => (pending.has(n.id) && !n.read ? { ...n, read: true } : n))

// Marca confirmada sai quando a resposta vem de leitura pedida depois da
// confirmação: essa já viu a gravação.
const prunedFor = (pending: ReadonlyMap<string, number | null>, request: number) =>
  new Map([...pending].filter(([, settledAt]) => settledAt === null || request <= settledAt))

// Confirmada, a marca guarda a última leitura já pedida; recusada, sai.
const settled = (
  pending: ReadonlyMap<string, number | null>,
  ids: string[],
  ok: boolean,
  lastRequest: number,
) => {
  const next = new Map(pending)
  for (const id of ids) {
    if (ok) next.set(id, lastRequest)
    else next.delete(id)
  }
  return next
}

export function withResponse(
  state: NotificationsState,
  response: NotificationsResponse,
): NotificationsState {
  if (response.request < state.lastApplied) return state
  const fresh = response.items.filter((n) => belongsInBell(n) && !state.pendingClear.has(n.id))
  const inResponse = new Set(fresh.map((n) => n.id))
  const later = state.items.filter(
    (n) => !inResponse.has(n.id) && (state.arrivals.get(n.id) ?? 0) > response.askedArrival,
  )
  const arrivals = new Map(
    [...state.arrivals].filter(([id, at]) => !inResponse.has(id) && at > response.askedArrival),
  )
  const items = withPendingReads([...later, ...fresh], state.pendingRead)
    .sort(newestFirst)
    .slice(0, NOTIFICATIONS_CAP)
  return {
    ...state,
    status: 'ready',
    items,
    arrivals,
    pendingRead: prunedFor(state.pendingRead, response.request),
    pendingClear: prunedFor(state.pendingClear, response.request),
    lastApplied: response.request,
  }
}

export function withArrival(state: NotificationsState, dto: NotificationDto): NotificationsState {
  const arrivalCount = state.arrivalCount + 1
  if (
    !belongsInBell(dto) ||
    state.pendingClear.has(dto.id) ||
    state.items.some((n) => n.id === dto.id)
  ) {
    return { ...state, arrivalCount }
  }
  const arrivals = new Map(state.arrivals).set(dto.id, arrivalCount)
  const items = withPendingReads([dto, ...state.items], state.pendingRead)
    .sort(newestFirst)
    .slice(0, NOTIFICATIONS_CAP)
  return { ...state, items, arrivals, arrivalCount }
}

/** Falha da leitura: antes da primeira resposta vira falha; depois, mantém a tela. */
export function withFailure(state: NotificationsState, request: number): NotificationsState {
  if (request < state.lastApplied || state.status === 'ready') return state
  return { ...state, status: 'failed' }
}

export function withLocalRead(state: NotificationsState, ids: string[]): NotificationsState {
  const pendingRead = new Map(state.pendingRead)
  for (const id of ids) pendingRead.set(id, null)
  return { ...state, pendingRead, items: withPendingReads(state.items, pendingRead) }
}

/**
 * Resposta do servidor à marca de lida. Confirmada, a marca guarda `lastRequest`
 * (a última leitura já pedida) e segue valendo até chegar resposta mais nova;
 * recusada, sai e a notificação volta a não lida.
 */
export function withReadSettled(
  state: NotificationsState,
  ids: string[],
  ok: boolean,
  lastRequest: number,
): NotificationsState {
  const back = new Set(ids)
  const pendingRead = settled(state.pendingRead, ids, ok, lastRequest)
  const items = ok
    ? state.items
    : state.items.map((n) => (back.has(n.id) ? { ...n, read: false } : n))
  return { ...state, pendingRead, items }
}

/** "Limpar todas": somem da tela na hora, antes de o servidor responder. */
export function withLocalClear(state: NotificationsState, ids: string[]): NotificationsState {
  const cleared = new Set(ids)
  const pendingClear = new Map(state.pendingClear)
  for (const id of ids) pendingClear.set(id, null)
  return {
    ...state,
    pendingClear,
    items: state.items.filter((n) => !cleared.has(n.id)),
    arrivals: new Map([...state.arrivals].filter(([id]) => !cleared.has(id))),
  }
}

/**
 * Resposta do servidor ao limpar, com a regra de `withReadSettled`. Recusada,
 * a marca sai e quem chamou relê para as notificações voltarem.
 */
export function withClearSettled(
  state: NotificationsState,
  ids: string[],
  ok: boolean,
  lastRequest: number,
): NotificationsState {
  return { ...state, pendingClear: settled(state.pendingClear, ids, ok, lastRequest) }
}

export function unreadCount(state: NotificationsState): number {
  return state.items.filter((n) => !n.read).length
}
