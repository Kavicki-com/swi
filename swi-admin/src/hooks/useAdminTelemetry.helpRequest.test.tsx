// O pino destacado e o cartão do pedido de ajuda saem de admin/workers. O
// pedido atendido ou fechado muda essa leitura sem condição nova, então o
// aviso help-request.changed também relê (com a mesma espera dos outros).
import { act, renderHook } from '@testing-library/react'
import type { TelemetryHandlers } from '@/services/telemetry/telemetrySocket'
import { adminSummary, adminWorker } from '@/test-utils/telemetryFixtures'
import { ADMIN_TELEMETRY_DEBOUNCE_MS, useAdminTelemetry } from './useAdminTelemetry'

const workersMock = vi.fn()
const summaryMock = vi.fn()
const subscribeMock = vi.fn()

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

beforeEach(() => {
  vi.useFakeTimers()
  workersMock.mockResolvedValue({ data: LIST, error: null })
  summaryMock.mockResolvedValue({ data: adminSummary(), error: null })
  subscribeMock.mockReturnValue(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

it('pedido de ajuda atendido relê a leitura da empresa', async () => {
  renderHook(() => useAdminTelemetry())
  await act(async () => {
    await Promise.resolve()
  })
  expect(workersMock).toHaveBeenCalledTimes(1)

  const handlers = subscribeMock.mock.calls[0]![0] as TelemetryHandlers
  expect(handlers.onHelpRequest).toBeTypeOf('function')
  act(() => {
    handlers.onHelpRequest?.({ workerId: 'w1', helpRequestId: 'a1', status: 'ATTENDED', at: 'x' })
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ADMIN_TELEMETRY_DEBOUNCE_MS)
  })
  expect(workersMock).toHaveBeenCalledTimes(2)
})
