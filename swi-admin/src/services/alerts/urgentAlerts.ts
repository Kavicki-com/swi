// Estado do aviso de alerta urgente, sem React e sem rede. A fonte é a fila de
// alertas abertos (OPEN) de categoria URGENT, isto é, batimento fora da faixa:
// desgaste, pressão e aparelho ficam no sino e no monitoramento.
//
// "Novo" é o alerta que não estava em leitura nenhuma antes desta. A primeira
// leitura depois de abrir o painel não tem novos: os abertos aparecem no aviso,
// mas não viram notificação do navegador.
import type { AlertQueueItem } from '@/services/api/telemetry'
import { alertDetailFrom } from '@/services/api/monitoring'
import { whenLabel } from '@/lib/whenLabel'

export type UrgentAlertsState = {
  loaded: boolean
  /** Urgentes abertos da última leitura aplicada, mais novo primeiro. */
  open: AlertQueueItem[]
  /** Todo id que já apareceu numa leitura aplicada. */
  known: ReadonlySet<string>
  /** Fechados pelo admin no aviso. */
  dismissed: ReadonlySet<string>
  lastApplied: number
}

export type UrgentAlertsRead = { request: number; items: AlertQueueItem[] }

export function initialUrgentAlerts(): UrgentAlertsState {
  return { loaded: false, open: [], known: new Set(), dismissed: new Set(), lastApplied: 0 }
}

const isOpenUrgent = (a: AlertQueueItem) => a.status === 'OPEN' && a.condition.category === 'URGENT'

const newestFirst = (a: AlertQueueItem, b: AlertQueueItem) =>
  Date.parse(b.createdAt) - Date.parse(a.createdAt)

export function withRead(
  state: UrgentAlertsState,
  read: UrgentAlertsRead,
): { state: UrgentAlertsState; fresh: AlertQueueItem[] } {
  if (read.request < state.lastApplied) return { state, fresh: [] }
  const open = read.items.filter(isOpenUrgent).sort(newestFirst)
  const fresh = state.loaded ? open.filter((a) => !state.known.has(a.id)) : []
  const openIds = new Set(open.map((a) => a.id))
  return {
    state: {
      loaded: true,
      open,
      known: new Set([...state.known, ...openIds]),
      // Alerta que saiu da fila não volta com o mesmo id: a marca pode sair.
      dismissed: new Set([...state.dismissed].filter((id) => openIds.has(id))),
      lastApplied: read.request,
    },
    fresh,
  }
}

export function visibleAlerts(state: UrgentAlertsState): AlertQueueItem[] {
  return state.open.filter((a) => !state.dismissed.has(a.id))
}

/** Fechar esconde os alertas que estão no aviso; alerta novo traz o aviso de volta. */
export function withDismissed(state: UrgentAlertsState): UrgentAlertsState {
  const ids = visibleAlerts(state).map((a) => a.id)
  return { ...state, dismissed: new Set([...state.dismissed, ...ids]) }
}

const lowerFirst = (s: string) => s.charAt(0).toLocaleLowerCase('pt-BR') + s.slice(1)

/** Título e mensagem do aviso; null sem alerta. A lista vem mais novo primeiro. */
export function noticeText(
  alerts: AlertQueueItem[],
  now: number,
): { title: string; message: string } | null {
  const newest = alerts[0]
  if (!newest) return null
  const condition = alertDetailFrom(newest).title
  const when = whenLabel(newest.condition.openedAt, now)
  const opened = when ? `, aberto ${when}` : ''
  if (alerts.length === 1) {
    return { title: `Alerta urgente: ${newest.worker.name}`, message: `${condition}${opened}.` }
  }
  return {
    title: `${alerts.length} alertas urgentes`,
    message: `Mais recente: ${newest.worker.name}, ${lowerFirst(condition)}${opened}.`,
  }
}
