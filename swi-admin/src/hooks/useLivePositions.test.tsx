// vitest globals (describe/it/expect/vi) via globals: true — importar de
// 'vitest' duplicaria a instância e quebraria o registro do suite (ver weather.test.ts).
import { act, renderHook, waitFor } from '@testing-library/react'
import type { PositionMarkerDto } from '@/services/api/positions'
import type { DashboardMapMarker } from '@/services/api/dashboard'
import { applyMarker, useLivePositions } from './useLivePositions'

const marker = (over: Partial<DashboardMapMarker> = {}): DashboardMapMarker => ({
  id: 'w1',
  name: 'João Silva',
  lat: -23.5505,
  lng: -46.6333,
  status: 'good',
  avatarUri: '',
  ...over,
})

const wsDto = (over: Partial<PositionMarkerDto> = {}): PositionMarkerDto => ({
  id: 'w1',
  name: 'João Silva',
  lat: -23.55,
  lng: -46.63,
  sector: null,
  avatar: '',
  recordedAt: '2026-07-25T12:00:05.000Z',
  ...over,
})

const listMock = vi.fn()
const subscribeMock = vi.fn()
const unsubscribeMock = vi.fn()

vi.mock('@/services/api/positions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/positions')>()
  return {
    ...actual,
    positionsApi: { list: (...args: unknown[]) => listMock(...args) },
  }
})

vi.mock('@/services/positions/positionsSocket', () => ({
  subscribePositions: (...args: unknown[]) => subscribeMock(...args),
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('applyMarker', () => {
  it('atualiza o marker existente pelo id sem duplicar', () => {
    const next = applyMarker([marker(), marker({ id: 'w2' })], marker({ lat: -23.54 }))
    expect(next).toHaveLength(2)
    expect(next.find((m) => m.id === 'w1')?.lat).toBe(-23.54)
  })

  it('insere marker de worker ainda não listado', () => {
    const next = applyMarker([marker()], marker({ id: 'w9', name: 'Nova' }))
    expect(next).toHaveLength(2)
    expect(next.some((m) => m.id === 'w9')).toBe(true)
  })
})

describe('useLivePositions', () => {
  it('carrega a lista inicial via REST e aplica updates do socket ao vivo', async () => {
    listMock.mockResolvedValue({ data: [marker()], error: null })
    subscribeMock.mockReturnValue(unsubscribeMock)

    const { result } = renderHook(() => useLivePositions())

    await waitFor(() => expect(result.current).toHaveLength(1))
    expect(result.current?.[0]?.lat).toBe(-23.5505)

    // O hook assinou o socket; o callback capturado é o canal do evento 'position'.
    expect(subscribeMock).toHaveBeenCalledTimes(1)
    const onPosition = subscribeMock.mock.calls[0]![0] as (dto: PositionMarkerDto) => void
    act(() => onPosition(wsDto({ lat: -23.54 })))

    expect(result.current?.[0]?.lat).toBe(-23.54)
  })

  it('desmontar fecha a assinatura do socket', async () => {
    listMock.mockResolvedValue({ data: [], error: null })
    subscribeMock.mockReturnValue(unsubscribeMock)

    const { unmount } = renderHook(() => useLivePositions())
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled())

    // Delta em volta do unmount: o auto-cleanup do testing-library desmonta o
    // hook do teste ANTERIOR depois do nosso afterEach limpar os mocks, então
    // contagem absoluta vaza entre testes.
    const before = unsubscribeMock.mock.calls.length
    unmount()
    expect(unsubscribeMock.mock.calls.length).toBe(before + 1)
  })
})
