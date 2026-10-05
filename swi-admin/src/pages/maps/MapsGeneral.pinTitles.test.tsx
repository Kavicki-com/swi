// Hora da posição velha no pino do mapa geral. Arquivo próprio porque o
// MapsGeneral.test.tsx está no limite de tamanho; os dublês aqui são o mínimo
// para a tela montar com a camada de operadores ligada (`?focus`).
// vitest globals (describe/it/expect/vi) via globals: true.
import { act, waitFor } from '@testing-library/react'
import { MapsGeneral } from './MapsGeneral'
import { clearSession, renderPage } from '@/test-utils/renderPage'

const live = vi.hoisted(() => ({ value: null as Array<Record<string, unknown>> | null }))
vi.mock('@/hooks/useLivePositions', () => ({ useLivePositions: () => live.value }))
vi.mock('@/hooks/useAdminTelemetry', () => ({
  useAdminTelemetry: () => ({
    workers: null,
    summary: null,
    loading: false,
    failed: false,
    refresh: () => {},
  }),
}))
vi.mock('@/services/api/telemetryDevices', () => ({
  telemetryDevicesApi: {
    stateOf: vi
      .fn()
      .mockResolvedValue({ data: { device: null, pendingEnrollment: null }, error: null }),
  },
}))
vi.mock('@/services/api/positionHeat', () => ({
  positionHeatApi: { heat: async () => ({ data: null, error: { message: 'sem trilha' } }) },
}))
vi.mock('@/lib/rainViewer', () => ({ getRainViewerLatestRadar: async () => null }))
vi.mock('@/services/api/cameras', () => ({ camerasApi: { list: async () => [] } }))
const toast = vi.hoisted(() => ({ show: vi.fn() }))
vi.mock('@/lib/demoToast', () => ({ useDemoToast: () => toast }))

// maplibre de mentira: o 'load' dispara na hora e cada Marker guarda o elemento.
const maplibre = vi.hoisted(() => {
  const elements: HTMLElement[] = []
  const makeMap = () => ({
    on: (event: string, cb: () => void) => {
      if (event === 'load') cb()
    },
    getLayer: () => undefined,
    getSource: () => undefined,
    addLayer: () => {},
    addSource: () => {},
    removeLayer: () => {},
    removeSource: () => {},
    fitBounds: () => {},
    flyTo: () => {},
    remove: () => {},
  })
  const makeMarker = (opts?: { element?: HTMLElement }) => {
    if (opts?.element) elements.push(opts.element)
    const marker = {
      setLngLat: () => marker,
      addTo: () => marker,
      remove: () => {},
      on: () => marker,
    }
    return marker
  }
  const lib = {
    Map: vi.fn(() => makeMap()),
    Marker: vi.fn((opts?: { element?: HTMLElement }) => makeMarker(opts)),
    LngLatBounds: vi.fn(() => ({ extend: () => {} })),
  }
  return { lib, elements }
})
vi.mock('@/lib/useMapLibre', () => ({ useMapLibre: () => maplibre.lib }))

const pinOf = (msAgo: number) => [
  {
    id: 'w1',
    name: 'Ana Souza',
    lat: -23.55,
    lng: -46.63,
    status: 'offline',
    avatarUri: '',
    recordedAt: new Date(Date.now() - msAgo).toISOString(),
  },
]

// Perto da meia-noite "10 minutos atrás" é ontem, e o texto ganha o dia.
const STALE_TITLE = /^Ana Souza, última posição (em \d{2}\/\d{2} )?às \d{2}:\d{2}$/

async function openMap() {
  const result = await renderPage(<MapsGeneral />, { route: '/maps/general?focus=w1' })
  await waitFor(() => expect(maplibre.elements).toHaveLength(1))
  return result
}

async function close(unmount: () => void) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
  await act(async () => {
    unmount()
  })
}

beforeEach(() => {
  maplibre.elements.length = 0
  maplibre.lib.Marker.mockClear()
})

afterEach(() => {
  clearSession()
  vi.useRealTimers()
})

describe('MapsGeneral: hora da posição no pino', () => {
  it('pino com posição velha leva a hora no texto de passar o mouse', async () => {
    live.value = pinOf(10 * 60_000)
    const { unmount } = await openMap()
    expect(maplibre.elements[0]!.title).toMatch(STALE_TITLE)
    await close(unmount)
  })

  it('posição atual não ganha texto', async () => {
    live.value = pinOf(60_000)
    const { unmount } = await openMap()
    expect(maplibre.elements[0]!.hasAttribute('title')).toBe(false)
    await close(unmount)
  })

  it('quando a posição passa de 5 minutos, o texto aparece sem refazer o pino', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    live.value = pinOf(4 * 60_000 + 50_000)
    const { unmount } = await openMap()
    expect(maplibre.elements[0]!.hasAttribute('title')).toBe(false)
    const built = maplibre.lib.Marker.mock.calls.length

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })

    expect(maplibre.elements[0]!.title).toMatch(STALE_TITLE)
    expect(maplibre.lib.Marker.mock.calls.length).toBe(built)
    await close(unmount)
  })

  it('posição nova que chega tira o texto do pino', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    live.value = pinOf(10 * 60_000)
    const { unmount } = await openMap()
    expect(maplibre.elements[0]!.title).toMatch(STALE_TITLE)

    live.value = pinOf(0)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })

    const last = maplibre.elements[maplibre.elements.length - 1]!
    expect(maplibre.elements.length).toBeGreaterThan(1)
    expect(last.hasAttribute('title')).toBe(false)
    await close(unmount)
  })
})
