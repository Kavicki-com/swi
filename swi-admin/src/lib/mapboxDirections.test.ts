import { fetchRoute, __resetRouteCache } from './mapboxDirections'

describe('fetchRoute', () => {
  beforeEach(() => {
    __resetRouteCache()
    vi.stubEnv('VITE_MAPBOX_TOKEN', 'pk.test-token')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('builds the Mapbox Directions URL with driving-traffic profile and geojson geometry', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        routes: [
          {
            geometry: {
              type: 'LineString',
              coordinates: [
                [-46.64, -23.555],
                [-46.62, -23.545],
              ],
            },
            duration: 1200,
            distance: 16000,
          },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    await fetchRoute({ from: [-46.64, -23.555], to: [-46.62, -23.545] })

    const url = String(fetchSpy.mock.calls[0]?.[0] ?? '')
    expect(url).toContain('api.mapbox.com/directions/v5/mapbox/driving-traffic/')
    expect(url).toContain('-46.64,-23.555;-46.62,-23.545')
    expect(url).toContain('geometries=geojson')
    expect(url).toContain('overview=full')
    expect(url).toContain('access_token=pk.test-token')
  })

  it('returns geometry + duration + distance from the first route', async () => {
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

    const result = await fetchRoute({ from: [1, 2], to: [3, 4] })
    expect(result).toEqual({
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
  })

  it('returns null when Mapbox returns no routes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ routes: [] }) }),
    )
    const result = await fetchRoute({ from: [1, 2], to: [3, 4] })
    expect(result).toBeNull()
  })

  it('returns null on HTTP error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }),
    )
    const result = await fetchRoute({ from: [1, 2], to: [3, 4] })
    expect(result).toBeNull()
  })

  it('returns null on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const result = await fetchRoute({ from: [1, 2], to: [3, 4] })
    expect(result).toBeNull()
  })

  it('returns null when token is missing', async () => {
    vi.stubEnv('VITE_MAPBOX_TOKEN', '')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const result = await fetchRoute({ from: [1, 2], to: [3, 4] })
    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('fetchRoute cache', () => {
  beforeEach(() => {
    __resetRouteCache()
    vi.stubEnv('VITE_MAPBOX_TOKEN', 'pk.test')
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('caches identical from/to pairs for 5 minutes', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        routes: [{ geometry: { type: 'LineString', coordinates: [] }, duration: 1, distance: 1 }],
      }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    await fetchRoute({ from: [1, 2], to: [3, 4] })
    await fetchRoute({ from: [1, 2], to: [3, 4] })
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(5 * 60 * 1000 + 1)
    await fetchRoute({ from: [1, 2], to: [3, 4] })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('different coords miss the cache', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        routes: [{ geometry: { type: 'LineString', coordinates: [] }, duration: 1, distance: 1 }],
      }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    await fetchRoute({ from: [1, 2], to: [3, 4] })
    await fetchRoute({ from: [1, 2], to: [5, 6] })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})
