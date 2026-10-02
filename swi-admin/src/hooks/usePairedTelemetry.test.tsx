// vitest globals (describe/it/expect/vi) via globals: true.
import { act, renderHook } from '@testing-library/react'
import { reporting } from '@/test-utils/telemetryFixtures'
import { usePairedTelemetry } from './usePairedTelemetry'

const stateOfMock = vi.fn()
const currentMock = vi.fn()

vi.mock('@/services/api/telemetryDevices', () => ({
  telemetryDevicesApi: { stateOf: (...a: unknown[]) => stateOfMock(...a) },
}))
vi.mock('@/services/api/telemetry', () => ({
  telemetryApi: { workerCurrent: (...a: unknown[]) => currentMock(...a) },
}))
vi.mock('@/services/telemetry/telemetrySocket', () => ({
  subscribeTelemetryEvents: () => () => {},
}))

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const PAIRED = {
  device: {
    id: 'd1',
    kind: 'IPHONE',
    model: null,
    pairedAt: '2026-10-01T10:00:00.000Z',
    lastSeenAt: null,
  },
  pendingEnrollment: null,
}

beforeEach(() => {
  stateOfMock.mockReset()
  currentMock.mockReset()
  currentMock.mockResolvedValue({ data: reporting(), error: null })
})

describe('usePairedTelemetry', () => {
  it('sem pessoa não busca nada', async () => {
    const { result } = renderHook(() => usePairedTelemetry(undefined))
    await flush()
    expect(stateOfMock).not.toHaveBeenCalled()
    expect(result.current.device).toBe('loading')
  })

  it('sem aparelho pareado não lê telemetria', async () => {
    stateOfMock.mockResolvedValue({ data: { device: null, pendingEnrollment: null }, error: null })
    const { result } = renderHook(() => usePairedTelemetry('u1'))
    await flush()
    expect(result.current.device).toBe('none')
    expect(currentMock).not.toHaveBeenCalled()
  })

  it('com aparelho pareado lê a telemetria da pessoa', async () => {
    stateOfMock.mockResolvedValue({ data: PAIRED, error: null })
    const { result } = renderHook(() => usePairedTelemetry('u1'))
    await flush()
    expect(result.current.device).toBe('paired')
    expect(currentMock).toHaveBeenCalledWith('u1')
    expect(result.current.telemetry?.metrics.heartRate.value).toBe(112)
  })

  // Sem saber se há aparelho, a tela não afirma nem "Sem aparelho".
  it('falha ao consultar o aparelho marca a falha', async () => {
    stateOfMock.mockResolvedValue({ data: null, error: { message: 'offline' } })
    const { result } = renderHook(() => usePairedTelemetry('u1'))
    await flush()
    expect(result.current.device).toBe('loading')
    expect(result.current.failed).toBe(true)
  })

  it('trocar de pessoa recomeça a consulta', async () => {
    stateOfMock.mockResolvedValue({ data: { device: null, pendingEnrollment: null }, error: null })
    const { rerender } = renderHook(({ id }: { id: string }) => usePairedTelemetry(id), {
      initialProps: { id: 'u1' },
    })
    await flush()
    rerender({ id: 'u2' })
    await flush()
    expect(stateOfMock).toHaveBeenLastCalledWith('u2')
  })
})
