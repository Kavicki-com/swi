// vitest globals (describe/it/expect/vi) via globals: true.
import { act, renderHook } from '@testing-library/react'
import type { TelemetryHandlers } from '@/services/telemetry/telemetrySocket'
import { adminSummary, adminWorker } from '@/test-utils/telemetryFixtures'
import {
  ADMIN_TELEMETRY_DEBOUNCE_MS,
  ADMIN_TELEMETRY_REFRESH_MS,
  useAdminTelemetry,
} from './useAdminTelemetry'

const workersMock = vi.fn()
const summaryMock = vi.fn()
const subscribeMock = vi.fn()
const unsubscribeMock = vi.fn()

vi.mock('@/services/api/telemetry', () => ({
  telemetryApi: {
    adminWorkers: (...args: unknown[]) => workersMock(...args),
    adminSummary: (...args: unknown[]) => summaryMock(...args),
  },
}))

vi.mock('@/services/telemetry/telemetrySocket', () => ({
  subscribeTelemetryEvents: (...args: unknown[]) => subscribeMock(...args),
}))

const LIST = { observedAt: 'x', workers: [adminWorker('w1', 'Ana Souza')] }

const handlers = (): TelemetryHandlers => subscribeMock.mock.calls[0]![0] as TelemetryHandlers

// Deixa as promessas resolvidas dos dublês chegarem ao estado do hook.
const flush = async () => {
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  workersMock.mockResolvedValue({ data: LIST, error: null })
  summaryMock.mockResolvedValue({ data: adminSummary(), error: null })
  subscribeMock.mockReturnValue(unsubscribeMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('useAdminTelemetry', () => {
  it('começa carregando e entrega a lista e o resumo da empresa', async () => {
    const { result } = renderHook(() => useAdminTelemetry())
    expect(result.current.loading).toBe(true)
    await flush()
    expect(result.current.loading).toBe(false)
    expect(result.current.failed).toBe(false)
    expect(result.current.workers?.workers[0]?.worker.name).toBe('Ana Souza')
    expect(result.current.summary?.urgentAlerts.workers).toBe(1)
  })

  // Uma rajada de avisos (vários relógios reportando juntos) vira uma releitura.
  it('vários avisos do socket em sequência geram uma releitura só', async () => {
    renderHook(() => useAdminTelemetry())
    await flush()
    expect(workersMock).toHaveBeenCalledTimes(1)

    act(() => {
      handlers().onSnapshot({
        workerId: 'w1',
        monitoringSessionId: 's',
        eventId: 'e1',
        revision: 'r1',
      })
      handlers().onSnapshot({
        workerId: 'w2',
        monitoringSessionId: 's',
        eventId: 'e2',
        revision: 'r2',
      })
      handlers().onCondition({
        workerId: 'w1',
        conditionId: 'c1',
        kind: 'HEART_RATE_HIGH',
        change: 'OPENED',
        at: 'x',
      })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ADMIN_TELEMETRY_DEBOUNCE_MS)
    })
    expect(workersMock).toHaveBeenCalledTimes(2)
    expect(summaryMock).toHaveBeenCalledTimes(2)
  })

  it('sem aviso nenhum, relê no intervalo de segurança', async () => {
    renderHook(() => useAdminTelemetry())
    await flush()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ADMIN_TELEMETRY_REFRESH_MS)
    })
    expect(workersMock).toHaveBeenCalledTimes(2)
  })

  // Manter a lista anterior faria o painel afirmar um estado que ninguém
  // consegue mais confirmar.
  it('falha limpa os dados e marca a falha', async () => {
    const { result } = renderHook(() => useAdminTelemetry())
    await flush()
    workersMock.mockResolvedValue({ data: null, error: { message: 'offline' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ADMIN_TELEMETRY_REFRESH_MS)
    })
    expect(result.current.failed).toBe(true)
    expect(result.current.workers).toBeNull()
    expect(result.current.summary).toBeNull()
  })

  it('refresh relê na hora', async () => {
    const { result } = renderHook(() => useAdminTelemetry())
    await flush()
    await act(async () => {
      result.current.refresh()
      await Promise.resolve()
    })
    expect(workersMock).toHaveBeenCalledTimes(2)
  })

  it('ao desmontar fecha o socket e para de reler', async () => {
    const { unmount } = renderHook(() => useAdminTelemetry())
    await flush()
    unmount()
    expect(unsubscribeMock).toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ADMIN_TELEMETRY_REFRESH_MS * 2)
    })
    expect(workersMock).toHaveBeenCalledTimes(1)
  })
})
