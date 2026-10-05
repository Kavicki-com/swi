import { vi } from 'vitest'
import type { AlertQueuePage, AlertQueueQuery, ConditionKind } from '@/services/api/telemetry'
import type { ConditionChanged } from '@/services/telemetry/telemetrySocket'
import type { ServiceResponse } from '@/services/types'
import { alertItem } from '@/test-utils/telemetryFixtures'
import {
  URGENT_RECHECK_MS,
  URGENT_REFETCH_DEBOUNCE_MS,
  createUrgentAlertsStore,
} from './urgentAlertsStore'
import { visibleAlerts } from './urgentAlerts'

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void }
const deferred = <T>(): Deferred<T> => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const page = (ids: string[]): ServiceResponse<AlertQueuePage> => ({
  data: { items: ids.map((id) => alertItem(id)), nextCursor: null },
  error: null,
})

const condition = (
  kind: ConditionKind,
  change: 'OPENED' | 'RECOVERED' = 'OPENED',
): ConditionChanged => ({
  workerId: 'w1',
  conditionId: 'c1',
  kind,
  change,
  at: '2026-10-05T12:00:00.000Z',
})

function setup() {
  const reads: Deferred<ServiceResponse<AlertQueuePage>>[] = []
  let onCondition: ((e: ConditionChanged) => void) | null = null
  let onTriaged: (() => void) | null = null
  const stopConditions = vi.fn()
  const stopTriaged = vi.fn()
  const onFresh = vi.fn()
  const api = {
    alerts: vi.fn((_q?: AlertQueueQuery) => {
      const d = deferred<ServiceResponse<AlertQueuePage>>()
      reads.push(d)
      return d.promise
    }),
  }
  const store = createUrgentAlertsStore({
    api,
    subscribeConditions: (cb) => {
      onCondition = cb
      return stopConditions
    },
    onTriaged: (cb) => {
      onTriaged = cb
      return stopTriaged
    },
    onFresh,
  })
  const answer = async (i: number, ids: string[]) => {
    reads[i]!.resolve(page(ids))
    await vi.advanceTimersByTimeAsync(0)
  }
  return {
    store,
    api,
    reads,
    onFresh,
    answer,
    stopConditions,
    stopTriaged,
    condition: (e: ConditionChanged) => onCondition!(e),
    triaged: () => onTriaged!(),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('createUrgentAlertsStore', () => {
  it('ao ligar lê os alertas abertos, até 100', async () => {
    const t = setup()
    t.store.start()
    expect(t.api.alerts).toHaveBeenCalledWith({ status: ['OPEN'], limit: 100 })
    await t.answer(0, ['a'])
    expect(visibleAlerts(t.store.getState()).map((a) => a.id)).toEqual(['a'])
    expect(t.onFresh).not.toHaveBeenCalled()
  })

  it('condição de batimento aberta relê depois da espera, e o alerta novo é avisado', async () => {
    const t = setup()
    t.store.start()
    await t.answer(0, ['a'])
    t.condition(condition('HEART_RATE_HIGH'))
    t.condition(condition('HEART_RATE_LOW'))
    expect(t.api.alerts).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(URGENT_REFETCH_DEBOUNCE_MS)
    expect(t.api.alerts).toHaveBeenCalledTimes(2)
    await t.answer(1, ['b', 'a'])
    expect(t.onFresh).toHaveBeenCalledTimes(1)
    expect(t.onFresh.mock.calls[0]![0].map((a: { id: string }) => a.id)).toEqual(['b'])
  })

  it('condição que não é de batimento, ou que se recuperou, não relê', async () => {
    const t = setup()
    t.store.start()
    await t.answer(0, [])
    t.condition(condition('WEAR_HIGH'))
    t.condition(condition('DEVICE_SIGNAL_LOST'))
    t.condition(condition('HEART_RATE_HIGH', 'RECOVERED'))
    await vi.advanceTimersByTimeAsync(URGENT_REFETCH_DEBOUNCE_MS)
    expect(t.api.alerts).toHaveBeenCalledTimes(1)
  })

  it('triagem feita aqui relê na hora', async () => {
    const t = setup()
    t.store.start()
    await t.answer(0, ['a'])
    t.triaged()
    expect(t.api.alerts).toHaveBeenCalledTimes(2)
  })

  it('releituras pedidas durante uma leitura viram uma só, depois dela', async () => {
    const t = setup()
    t.store.start()
    t.store.refresh()
    t.store.refresh()
    expect(t.api.alerts).toHaveBeenCalledTimes(1)
    await t.answer(0, [])
    expect(t.api.alerts).toHaveBeenCalledTimes(2)
  })

  it('com aviso na tela relê a cada minuto; sem aviso, para', async () => {
    const t = setup()
    t.store.start()
    await t.answer(0, ['a'])
    await vi.advanceTimersByTimeAsync(URGENT_RECHECK_MS)
    expect(t.api.alerts).toHaveBeenCalledTimes(2)
    await t.answer(1, [])
    await vi.advanceTimersByTimeAsync(URGENT_RECHECK_MS * 3)
    expect(t.api.alerts).toHaveBeenCalledTimes(2)
  })

  it('fechar o aviso esconde e para a releitura de minuto', async () => {
    const t = setup()
    t.store.start()
    await t.answer(0, ['a'])
    t.store.dismiss()
    expect(visibleAlerts(t.store.getState())).toEqual([])
    await vi.advanceTimersByTimeAsync(URGENT_RECHECK_MS * 2)
    expect(t.api.alerts).toHaveBeenCalledTimes(1)
  })

  it('leitura que rejeita não trava as próximas', async () => {
    const t = setup()
    t.api.alerts.mockImplementationOnce(() => Promise.reject(new Error('rede')))
    t.store.start()
    await vi.advanceTimersByTimeAsync(0)
    t.store.refresh()
    expect(t.api.alerts).toHaveBeenCalledTimes(2)
  })

  // A notificação do navegador roda dentro da leitura: se ela quebrar, o aviso
  // do painel e as releituras seguem.
  it('falha ao avisar o navegador não trava o aviso nem as releituras', async () => {
    const t = setup()
    t.onFresh.mockImplementation(() => {
      throw new Error('construtor recusado')
    })
    t.store.start()
    await t.answer(0, ['a'])
    t.store.refresh()
    await t.answer(1, ['b', 'a'])
    expect(visibleAlerts(t.store.getState()).map((a) => a.id)).toEqual(['b', 'a'])
    await vi.advanceTimersByTimeAsync(URGENT_RECHECK_MS)
    expect(t.api.alerts).toHaveBeenCalledTimes(3)
  })

  it('falha na leitura mantém o que está na tela', async () => {
    const t = setup()
    t.store.start()
    await t.answer(0, ['a'])
    t.store.refresh()
    t.reads[1]!.resolve({ data: null, error: { message: 'falhou' } })
    await vi.advanceTimersByTimeAsync(0)
    expect(visibleAlerts(t.store.getState()).map((a) => a.id)).toEqual(['a'])
  })

  it('desligado, solta os ouvintes, os relógios e ignora resposta atrasada', async () => {
    const t = setup()
    const stop = t.store.start()
    stop()
    expect(t.stopConditions).toHaveBeenCalled()
    expect(t.stopTriaged).toHaveBeenCalled()
    await t.answer(0, ['a'])
    expect(t.store.getState().loaded).toBe(false)
    await vi.advanceTimersByTimeAsync(URGENT_RECHECK_MS * 2)
    expect(t.api.alerts).toHaveBeenCalledTimes(1)
  })
})
