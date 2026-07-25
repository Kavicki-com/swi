// vitest globals (describe/it/expect/vi) via globals: true — importar de
// 'vitest' duplicaria a instância e quebraria o registro do suite (ver weather.test.ts).
import { act, renderHook, waitFor } from '@testing-library/react'
import type { EvacuationProgressDto } from '@/services/api/evacuations'
import { useEvacuation } from './useEvacuation'

const dto = (over: Partial<EvacuationProgressDto> = {}): EvacuationProgressDto => ({
  id: 'ev1',
  status: 'ACTIVE',
  startedAt: '2026-07-25T18:00:00.000Z',
  endedAt: null,
  total: 2,
  acked: 0,
  workers: [
    { id: 'w1', name: 'Worker Um', acked: false, ackAt: null },
    { id: 'w2', name: 'Worker Dois', acked: false, ackAt: null },
  ],
  ...over,
})

const activeMock = vi.fn()
const startMock = vi.fn()
const endMock = vi.fn()
const subscribeMock = vi.fn()
const unsubscribeMock = vi.fn()

vi.mock('@/services/api/evacuations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/evacuations')>()
  return {
    ...actual,
    evacuationsApi: {
      active: (...a: unknown[]) => activeMock(...a),
      start: (...a: unknown[]) => startMock(...a),
      end: (...a: unknown[]) => endMock(...a),
    },
  }
})

vi.mock('@/services/evacuations/evacuationsSocket', () => ({
  subscribeEvacuationEvents: (...a: unknown[]) => subscribeMock(...a),
}))

type Handlers = {
  onStarted: (d: EvacuationProgressDto) => void
  onAck: (p: { evacuationId: string; workerId: string; acked: number; total: number }) => void
  onEnded: (p: { id: string }) => void
}

const capturedHandlers = (): Handlers => subscribeMock.mock.calls[0]![0] as Handlers

afterEach(() => {
  vi.clearAllMocks()
})

describe('useEvacuation', () => {
  beforeEach(() => {
    activeMock.mockResolvedValue({ data: null, error: null })
    subscribeMock.mockReturnValue(unsubscribeMock)
  })

  it('carrega a ativa no mount', async () => {
    activeMock.mockResolvedValue({ data: dto({ acked: 1 }), error: null })
    const { result } = renderHook(() => useEvacuation())
    await waitFor(() => expect(result.current.evacuation?.id).toBe('ev1'))
    expect(result.current.evacuation?.acked).toBe(1)
  })

  it('WS evacuation (started) popula; evacuation-ack ATUALIZA X e o worker; ended zera', async () => {
    const { result } = renderHook(() => useEvacuation())
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled())
    const h = capturedHandlers()

    act(() => h.onStarted(dto()))
    expect(result.current.evacuation?.acked).toBe(0)

    act(() => h.onAck({ evacuationId: 'ev1', workerId: 'w1', acked: 1, total: 2 }))
    expect(result.current.evacuation?.acked).toBe(1)
    expect(result.current.evacuation?.workers.find((w) => w.id === 'w1')?.acked).toBe(true)

    // Ack de OUTRA evacuação (corrida rara) é ignorado.
    act(() => h.onAck({ evacuationId: 'ev-outra', workerId: 'w2', acked: 9, total: 9 }))
    expect(result.current.evacuation?.acked).toBe(1)

    act(() => h.onEnded({ id: 'ev1' }))
    expect(result.current.evacuation).toBeNull()
  })

  it('start() chama a API e aplica o dto; erro de negócio vira mensagem', async () => {
    startMock.mockResolvedValue({ data: dto(), error: null })
    const { result } = renderHook(() => useEvacuation())
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled())

    await act(async () => {
      await result.current.start()
    })
    expect(result.current.evacuation?.id).toBe('ev1')
    expect(result.current.error).toBeNull()

    startMock.mockResolvedValue({ data: null, error: { message: 'Já existe uma evacuação ativa' } })
    await act(async () => {
      await result.current.start()
    })
    expect(result.current.error).toBe('Já existe uma evacuação ativa')
  })

  it('end() chama a API com o id da ativa e zera o estado', async () => {
    activeMock.mockResolvedValue({ data: dto(), error: null })
    endMock.mockResolvedValue({ data: null, error: null })
    const { result } = renderHook(() => useEvacuation())
    await waitFor(() => expect(result.current.evacuation?.id).toBe('ev1'))

    await act(async () => {
      await result.current.end()
    })
    expect(endMock).toHaveBeenCalledWith('ev1')
    expect(result.current.evacuation).toBeNull()
  })

  it('desmontar fecha a assinatura do socket', async () => {
    const { unmount } = renderHook(() => useEvacuation())
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled())
    // Delta em volta do unmount: o auto-cleanup do testing-library desmonta o
    // hook do teste ANTERIOR depois do afterEach limpar os mocks.
    const before = unsubscribeMock.mock.calls.length
    unmount()
    expect(unsubscribeMock.mock.calls.length).toBe(before + 1)
  })
})
