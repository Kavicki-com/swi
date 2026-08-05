import { renderHook, waitFor } from '@testing-library/react'
import { useRescueRoute } from './useRescueRoute'
import { __resetRouteCache } from '@/lib/mapboxDirections'

describe('useRescueRoute', () => {
  beforeEach(() => {
    __resetRouteCache()
    vi.stubEnv('VITE_MAPBOX_TOKEN', 'pk.test')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('starts in loading state and resolves to the route', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          routes: [
            {
              geometry: {
                type: 'LineString',
                coordinates: [
                  [1, 2],
                  [3, 4],
                ],
              },
              duration: 600,
              distance: 5000,
            },
          ],
        }),
      }),
    )

    const { result } = renderHook(() => useRescueRoute([1, 2], [3, 4]))
    expect(result.current.loading).toBe(true)
    expect(result.current.route).toBeNull()

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.route).toEqual({
      geometry: {
        type: 'LineString',
        coordinates: [
          [1, 2],
          [3, 4],
        ],
      },
      duration: 600,
      distance: 5000,
    })
    expect(result.current.error).toBe(false)
  })

  // As pontas do socorro vêm das posições AO VIVO, que só chegam depois do
  // primeiro render. Enquanto uma delas for null o hook NÃO pode pedir rota:
  // qualquer coordenada default desenharia um trajeto que não é de ninguém
  // (era o bug das constantes fixas — QA 2026-07-26).
  it('não busca rota enquanto uma das pontas for desconhecida', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { result, rerender } = renderHook(
      ({ from }: { from: [number, number] | null }) => useRescueRoute(from, [3, 4]),
      { initialProps: { from: null as [number, number] | null } },
    )
    expect(result.current.loading).toBe(true)
    expect(result.current.error).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        routes: [
          { geometry: { type: 'LineString', coordinates: [[1, 2]] }, duration: 60, distance: 100 },
        ],
      }),
    })
    rerender({ from: [1, 2] })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.route?.distance).toBe(100)
  })

  // O efeito depende das COORDENADAS, não da identidade das tuplas: as posições
  // ao vivo chegam num array novo a cada poll, e reagir à identidade refaria a
  // busca de rota a cada render sem que nada tivesse mudado de lugar.
  it('refaz a busca só quando alguma coordenada muda', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        routes: [
          { geometry: { type: 'LineString', coordinates: [[1, 2]] }, duration: 60, distance: 100 },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result, rerender } = renderHook(
      ({ from }: { from: [number, number] }) => useRescueRoute(from, [3, 4]),
      { initialProps: { from: [1, 2] as [number, number] } },
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Tupla NOVA, mesmas coordenadas: não pode refazer.
    rerender({ from: [1, 2] })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Coordenada diferente: tem que refazer. O cache de rota é por par de
    // pontas, então um par novo não é servido pelo cache.
    rerender({ from: [9, 9] })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('sets error=true when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const { result } = renderHook(() => useRescueRoute([1, 2], [3, 4]))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.route).toBeNull()
    expect(result.current.error).toBe(true)
  })
})
