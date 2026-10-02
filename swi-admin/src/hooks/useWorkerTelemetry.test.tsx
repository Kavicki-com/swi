// vitest globals (describe/it/expect/vi) via globals: true.
import { act, renderHook } from '@testing-library/react'
import type { TelemetryHandlers } from '@/services/telemetry/telemetrySocket'
import { reporting } from '@/test-utils/telemetryFixtures'
import { TELEMETRY_REFRESH_MS, useWorkerTelemetry } from './useWorkerTelemetry'

const currentMock = vi.fn()
const subscribeMock = vi.fn()
const unsubscribeMock = vi.fn()

vi.mock('@/services/api/telemetry', () => ({
  telemetryApi: { workerCurrent: (...args: unknown[]) => currentMock(...args) },
}))

vi.mock('@/services/telemetry/telemetrySocket', () => ({
  subscribeTelemetryEvents: (...args: unknown[]) => subscribeMock(...args),
}))

const handlers = (): TelemetryHandlers => subscribeMock.mock.calls[0]![0] as TelemetryHandlers

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
  })
}

const snapshotOf = (workerId: string) => ({
  workerId,
  monitoringSessionId: 's',
  eventId: 'e',
  revision: 'r',
})

beforeEach(() => {
  vi.useFakeTimers()
  currentMock.mockResolvedValue({ data: reporting(), error: null })
  subscribeMock.mockReturnValue(unsubscribeMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('useWorkerTelemetry', () => {
  it('relê quando o socket avisa leitura nova deste funcionário', async () => {
    renderHook(() => useWorkerTelemetry('w1'))
    await flush()
    expect(currentMock).toHaveBeenCalledTimes(1)
    await act(async () => {
      handlers().onSnapshot(snapshotOf('w1'))
      await Promise.resolve()
    })
    expect(currentMock).toHaveBeenCalledTimes(2)
  })

  it('relê quando uma condição deste funcionário muda', async () => {
    renderHook(() => useWorkerTelemetry('w1'))
    await flush()
    await act(async () => {
      handlers().onCondition({
        workerId: 'w1',
        conditionId: 'c1',
        kind: 'WEAR_HIGH',
        change: 'OPENED',
        at: 'x',
      })
      await Promise.resolve()
    })
    expect(currentMock).toHaveBeenCalledTimes(2)
  })

  it('ignora aviso de outro funcionário', async () => {
    renderHook(() => useWorkerTelemetry('w1'))
    await flush()
    await act(async () => {
      handlers().onSnapshot(snapshotOf('w2'))
      await Promise.resolve()
    })
    expect(currentMock).toHaveBeenCalledTimes(1)
  })

  it('mantém a releitura de segurança no intervalo', async () => {
    renderHook(() => useWorkerTelemetry('w1'))
    await flush()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TELEMETRY_REFRESH_MS)
    })
    expect(currentMock).toHaveBeenCalledTimes(2)
  })

  it('ao desmontar fecha o socket', async () => {
    const { unmount } = renderHook(() => useWorkerTelemetry('w1'))
    await flush()
    unmount()
    expect(unsubscribeMock).toHaveBeenCalled()
  })

  it('sem funcionário não lê nem abre socket', () => {
    renderHook(() => useWorkerTelemetry(undefined))
    expect(currentMock).not.toHaveBeenCalled()
    expect(subscribeMock).not.toHaveBeenCalled()
  })
})
