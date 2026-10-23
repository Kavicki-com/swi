// Pedido de ajuda no aviso de alerta urgente: a abertura chega como condição
// HELP_REQUESTED e relê a fila; atendido e fechado chegam só pelo aviso
// help-request.changed, que também relê, para o aviso sumir na hora em que
// alguém despacha um socorrista.
import { vi } from 'vitest'
import type { AlertQueuePage } from '@/services/api/telemetry'
import type { ConditionChanged, HelpRequestChanged } from '@/services/telemetry/telemetrySocket'
import type { ServiceResponse } from '@/services/types'
import { URGENT_REFETCH_DEBOUNCE_MS, createUrgentAlertsStore } from './urgentAlertsStore'

const EMPTY: ServiceResponse<AlertQueuePage> = {
  data: { items: [], nextCursor: null },
  error: null,
}

function setup() {
  let onCondition: ((e: ConditionChanged) => void) | null = null
  let onHelp: ((e: HelpRequestChanged) => void) | null = null
  const stopHelp = vi.fn()
  const api = { alerts: vi.fn(async () => EMPTY) }
  const store = createUrgentAlertsStore({
    api,
    subscribeConditions: (cb) => {
      onCondition = cb
      return () => {}
    },
    subscribeHelpRequests: (cb) => {
      onHelp = cb
      return stopHelp
    },
    onTriaged: () => () => {},
    onFresh: () => {},
  })
  return {
    store,
    api,
    stopHelp,
    condition: (e: ConditionChanged) => onCondition!(e),
    help: (e: HelpRequestChanged) => onHelp!(e),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('aviso urgente e pedido de ajuda', () => {
  it('a abertura de um pedido de ajuda relê a fila, como as outras urgentes', async () => {
    const t = setup()
    const stop = t.store.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(t.api.alerts).toHaveBeenCalledTimes(1)

    t.condition({
      workerId: 'w1',
      conditionId: 'c1',
      kind: 'HELP_REQUESTED',
      change: 'OPENED',
      at: '2026-10-22T12:00:00.000Z',
    })
    await vi.advanceTimersByTimeAsync(URGENT_REFETCH_DEBOUNCE_MS)
    expect(t.api.alerts).toHaveBeenCalledTimes(2)
    stop()
  })

  it('pedido atendido ou fechado relê a fila na hora', async () => {
    const t = setup()
    const stop = t.store.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(t.api.alerts).toHaveBeenCalledTimes(1)

    t.help({ workerId: 'w1', helpRequestId: 'a1', status: 'ATTENDED', at: 'x' })
    await vi.advanceTimersByTimeAsync(0)
    expect(t.api.alerts).toHaveBeenCalledTimes(2)

    t.help({ workerId: 'w1', helpRequestId: 'a1', status: 'CLOSED', at: 'y' })
    await vi.advanceTimersByTimeAsync(0)
    expect(t.api.alerts).toHaveBeenCalledTimes(3)
    stop()
  })

  it('para de escutar o pedido de ajuda ao desligar', async () => {
    const t = setup()
    const stop = t.store.start()
    await vi.advanceTimersByTimeAsync(0)
    stop()
    expect(t.stopHelp).toHaveBeenCalledTimes(1)
  })
})
