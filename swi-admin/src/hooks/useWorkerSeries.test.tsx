// vitest globals (describe/it/expect/vi) via globals: true.
import { act, renderHook } from '@testing-library/react'
import { emptyPoint, series } from '@/test-utils/telemetryFixtures'
import { useWorkerSeries } from './useWorkerSeries'

const seriesMock = vi.fn()

vi.mock('@/services/api/telemetry', () => ({
  telemetryApi: { workerSeries: (...args: unknown[]) => seriesMock(...args) },
}))

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
  })
}

const withKcal = (kcal: number | null) =>
  series(
    [
      {
        ...emptyPoint('2026-10-01T11:00:00.000Z', '2026-10-01T12:00:00.000Z'),
        activeEnergyKcal: kcal,
      },
    ],
    {
      bucket: 'hour',
      period: 'day',
    },
  )

beforeEach(() => {
  seriesMock.mockReset()
})

describe('useWorkerSeries', () => {
  it('sem funcionário não busca nada e diz que não há aparelho', async () => {
    const { result } = renderHook(() => useWorkerSeries(undefined, 'day'))
    await flush()
    expect(seriesMock).not.toHaveBeenCalled()
    expect(result.current).toEqual({ points: [], loading: false, failed: false, noDevice: true })
  })

  it('busca o período pedido e entrega os pontos do gráfico', async () => {
    seriesMock.mockResolvedValue({ data: withKcal(62), error: null })
    const { result } = renderHook(() => useWorkerSeries('w1', 'day'))
    expect(result.current.loading).toBe(true)
    await flush()
    expect(seriesMock).toHaveBeenCalledWith('w1', 'day')
    expect(result.current.loading).toBe(false)
    expect(result.current.points).toHaveLength(1)
    expect(result.current.points[0]!.kcal).toBe(62)
  })

  it('trocar o período busca de novo', async () => {
    seriesMock.mockResolvedValue({ data: withKcal(62), error: null })
    const { rerender } = renderHook(({ p }: { p: 'day' | 'week' }) => useWorkerSeries('w1', p), {
      initialProps: { p: 'day' as 'day' | 'week' },
    })
    await flush()
    rerender({ p: 'week' })
    await flush()
    expect(seriesMock).toHaveBeenLastCalledWith('w1', 'week')
  })

  it('falha marca a falha e não mostra curva', async () => {
    seriesMock.mockResolvedValue({ data: null, error: { message: 'offline' } })
    const { result } = renderHook(() => useWorkerSeries('w1', 'day'))
    await flush()
    expect(result.current).toEqual({ points: [], loading: false, failed: true, noDevice: false })
  })

  it('período sem medição devolve lista vazia, não zeros', async () => {
    seriesMock.mockResolvedValue({ data: withKcal(null), error: null })
    const { result } = renderHook(() => useWorkerSeries('w1', 'day'))
    await flush()
    expect(result.current.points).toEqual([])
    expect(result.current.failed).toBe(false)
  })
})
