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

  it('sets error=true when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const { result } = renderHook(() => useRescueRoute([1, 2], [3, 4]))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.route).toBeNull()
    expect(result.current.error).toBe(true)
  })
})
