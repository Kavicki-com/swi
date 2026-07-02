import { getRainViewerLatestRadar, __resetCache } from './rainViewer'

describe('getRainViewerLatestRadar', () => {
  beforeEach(() => {
    __resetCache()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns the latest past radar path', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
          host: 'https://tilecache.rainviewer.com',
          radar: { past: [{ path: '/v2/radar/old' }, { path: '/v2/radar/latest' }] },
        }),
      }),
    )
    const result = await getRainViewerLatestRadar()
    expect(result).toEqual({
      host: 'https://tilecache.rainviewer.com',
      path: '/v2/radar/latest',
    })
  })

  it('caches manifest for 10 minutes', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      json: async () => ({ host: 'https://h', radar: { past: [{ path: '/p' }] } }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    await getRainViewerLatestRadar()
    await getRainViewerLatestRadar()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10 * 60 * 1000 + 1)
    await getRainViewerLatestRadar()
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('returns null on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const result = await getRainViewerLatestRadar()
    expect(result).toBeNull()
  })
})
