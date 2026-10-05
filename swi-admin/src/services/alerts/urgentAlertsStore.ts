// Armazém do aviso de alerta urgente: lê a fila de alertas abertos e aplica as
// regras puras de urgentAlerts. O socket só diz que uma condição abriu, sem
// nome nem categoria e também para dados de demonstração; a fila traz o nome,
// a categoria e já filtra a demonstração, então é ela que vale.
//
// Relê: ao ligar; quando abre condição de batimento (com a mesma espera do
// monitoramento, porque várias chegam juntas); quando alguém triou aqui; e a
// cada minuto enquanto houver aviso na tela, para sumir quando outro admin
// reconhecer. Volta da conexão e da aba chegam pelo provider.
import type {
  AlertQueuePage,
  AlertQueueItem,
  AlertQueueQuery,
  ConditionKind,
} from '@/services/api/telemetry'
import type { ConditionChanged } from '@/services/telemetry/telemetrySocket'
import type { ServiceResponse } from '@/services/types'
import {
  initialUrgentAlerts,
  visibleAlerts,
  withDismissed,
  withRead,
  type UrgentAlertsState,
} from './urgentAlerts'

export const URGENT_REFETCH_DEBOUNCE_MS = 1_000
export const URGENT_RECHECK_MS = 60_000
/** O servidor devolve no máximo 100 por página. */
const QUERY: AlertQueueQuery = { status: ['OPEN'], limit: 100 }
const URGENT_KINDS = new Set<ConditionKind>(['HEART_RATE_HIGH', 'HEART_RATE_LOW'])

export interface UrgentAlertsStoreDeps {
  api: { alerts(query?: AlertQueueQuery): Promise<ServiceResponse<AlertQueuePage>> }
  subscribeConditions(cb: (e: ConditionChanged) => void): () => void
  onTriaged(cb: () => void): () => void
  /** Alertas que não estavam em leitura nenhuma antes desta. */
  onFresh(fresh: AlertQueueItem[]): void
}

export interface UrgentAlertsStore {
  getState(): UrgentAlertsState
  subscribe(listener: () => void): () => void
  start(): () => void
  refresh(): void
  dismiss(): void
}

export function createUrgentAlertsStore(deps: UrgentAlertsStoreDeps): UrgentAlertsStore {
  let state = initialUrgentAlerts()
  const listeners = new Set<() => void>()
  let generation = 0
  let active = false
  let requests = 0
  let inFlight = false
  let again = false
  let debounce: ReturnType<typeof setTimeout> | null = null
  let recheck: ReturnType<typeof setTimeout> | null = null

  const set = (next: UrgentAlertsState) => {
    if (next === state) return
    state = next
    for (const l of [...listeners]) l()
  }

  const clearRecheck = () => {
    if (recheck) clearTimeout(recheck)
    recheck = null
  }

  // Um relógio só: armado depois de cada leitura enquanto houver aviso.
  const armRecheck = () => {
    clearRecheck()
    if (!active || visibleAlerts(state).length === 0) return
    recheck = setTimeout(() => {
      recheck = null
      read()
    }, URGENT_RECHECK_MS)
  }

  const read = () => {
    if (!active) return
    if (inFlight) {
      again = true
      return
    }
    inFlight = true
    const gen = generation
    const request = ++requests
    void deps.api
      .alerts(QUERY)
      // Promessa que rejeita vira falha comum: sem isto a leitura ficaria
      // "em voo" para sempre e nenhuma outra sairia.
      .catch(
        (): ServiceResponse<AlertQueuePage> => ({
          data: null,
          error: { message: 'Falha ao carregar os alertas' },
        }),
      )
      .then((res) => {
        if (gen !== generation) return
        inFlight = false
        if (res.data) {
          const { state: next, fresh } = withRead(state, { request, items: res.data.items })
          set(next)
          // A notificação do navegador não pode travar o aviso nem as releituras.
          if (fresh.length > 0) {
            try {
              deps.onFresh(fresh)
            } catch {
              // segue sem a notificação do navegador
            }
          }
        }
        armRecheck()
        if (again) {
          again = false
          read()
        }
      })
  }

  const onCondition = (e: ConditionChanged) => {
    if (e.change !== 'OPENED' || !URGENT_KINDS.has(e.kind)) return
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      debounce = null
      read()
    }, URGENT_REFETCH_DEBOUNCE_MS)
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
      const stopConditions = deps.subscribeConditions(onCondition)
      const stopTriaged = deps.onTriaged(read)
      read()
      return () => {
        active = false
        generation += 1
        if (debounce) clearTimeout(debounce)
        debounce = null
        clearRecheck()
        stopConditions()
        stopTriaged()
      }
    },
    refresh: read,
    dismiss() {
      set(withDismissed(state))
      armRecheck()
    },
  }
}
