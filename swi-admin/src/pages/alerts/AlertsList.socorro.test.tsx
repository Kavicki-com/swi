// Socorro e evacuação na mesma tela sem se misturar: a rota de socorro tem
// entrada própria na barra e os pinos param durante o desenho da área.
// Dublês: os do AlertsList.helpRequest.test.tsx, com o onClick do pino, os
// handlers do mapa guardados para o teste disparar o clique, e o elemento do
// Marker no documento (como no AlertsList.behaviour.test.tsx).
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { AlertsList } from './AlertsList'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import type { AdminWorkersTelemetry } from '@/services/api/telemetry'
import { adminWorker, FIXTURE_AT } from '@/test-utils/telemetryFixtures'

const h = vi.hoisted(() => ({
  positions: [] as Array<Record<string, unknown>>,
  workers: null as AdminWorkersTelemetry | null,
  evacuation: null as null | {
    acked: number
    total: number
    workers: Array<{ id: string; acked: boolean }>
  },
  navigations: [] as string[],
  pins: [] as Array<{ status: unknown; name: unknown; onClick: () => void }>,
}))

vi.mock('@/hooks/useWeatherAlert', () => ({
  useWeatherAlert: () => ({ alert: null, demo: false }),
}))
vi.mock('@/hooks/useLivePositions', () => ({ useLivePositions: () => h.positions }))
vi.mock('@/hooks/useAdminTelemetry', () => ({
  useAdminTelemetry: () => ({
    workers: h.workers,
    summary: null,
    loading: false,
    failed: false,
    refresh: () => {},
  }),
}))
vi.mock('@/hooks/useEvacuation', () => ({
  useEvacuation: () => ({ evacuation: h.evacuation, error: null, start: vi.fn(), end: vi.fn() }),
}))
vi.mock('@/services/api/positionHeat', () => ({
  positionHeatApi: { heat: async () => ({ data: null, error: null }) },
}))
vi.mock('@/lib/rainViewer', () => ({ getRainViewerLatestRadar: async () => null }))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => (to: string) => {
      h.navigations.push(to)
    },
  }
})
vi.mock('@/lib/pinFactory', () => ({
  createPinElement: ({
    onClick,
    content,
  }: {
    onClick: () => void
    content: { props: Record<string, unknown> }
  }) => {
    h.pins.push({ status: content.props.status, name: content.props.name, onClick })
    return { el: document.createElement('div'), root: { unmount: () => {} } }
  },
}))

// Handlers do mapa por evento: o teste dispara o clique no mapa vazio.
let mapHandlers: Record<string, Array<(e: unknown) => void>> = {}

function makeLib() {
  const map = {
    on: (ev: string, cb: (e?: unknown) => void) => {
      ;(mapHandlers[ev] ??= []).push(cb)
      if (ev === 'load') cb()
    },
    off: (ev: string, cb: (e?: unknown) => void) => {
      mapHandlers[ev] = (mapHandlers[ev] ?? []).filter((f) => f !== cb)
    },
    project: () => ({ x: 100, y: 200 }),
    getLayer: () => undefined,
    getSource: () => undefined,
    addLayer: () => {},
    addSource: () => {},
    removeLayer: () => {},
    removeSource: () => {},
    fitBounds: () => {},
    remove: () => {},
  }
  // O elemento do marcador vai para o documento, como no maplibre.
  class Marker {
    el?: HTMLElement
    constructor(opts?: { element?: HTMLElement }) {
      this.el = opts?.element
    }
    setLngLat() {
      return this
    }
    addTo() {
      if (this.el) document.body.appendChild(this.el)
      return this
    }
    on() {
      return this
    }
    getLngLat() {
      return { lng: 0, lat: 0 }
    }
    remove() {
      this.el?.remove()
    }
  }
  class LngLatBounds {
    extend() {}
  }
  class FakeMap {
    constructor() {
      return map as unknown as FakeMap
    }
  }
  return { Map: FakeMap, Marker, LngLatBounds }
}
// Estável entre renders, como no teste vizinho: o mapa nasce uma vez só.
let currentLib: ReturnType<typeof makeLib>
vi.mock('@/lib/useMapLibre', () => ({ useMapLibre: () => currentLib }))

const position = (id: string, name: string) => ({
  id,
  name,
  lat: -23.55,
  lng: -46.63,
  status: 'offline',
  avatarUri: '',
})

const telemetry = (): AdminWorkersTelemetry => ({
  observedAt: FIXTURE_AT,
  workers: [adminWorker('w2', 'Bruno Souza'), adminWorker('w1', 'Ana Lima')],
})

const renderAlerts = (route = '/alerts') =>
  renderPage(<AlertsList />, { route, path: '/alerts/:employeeId?' })

const clickMapAt = (lng: number, lat: number) =>
  (mapHandlers.click ?? []).forEach((cb) => cb({ lngLat: { lng, lat } }))

beforeEach(() => {
  h.positions = [position('w2', 'Bruno Souza'), position('w1', 'Ana Lima')]
  h.workers = telemetry()
  h.evacuation = null
  h.navigations = []
  h.pins = []
  mapHandlers = {}
  currentLib = makeLib()
})

afterEach(clearSession)

describe('AlertsList: entrada da rota de socorro', () => {
  it('"Rota de socorro" e depois o pino vai direto para a lista de socorristas', async () => {
    await renderAlerts()
    await waitFor(() => expect(h.pins).toHaveLength(2))

    await act(async () => {
      fireEvent.click(screen.getByText('Rota de socorro'))
    })
    expect(screen.getByTestId('rescue-pick-hint')).toBeTruthy()

    const pin = h.pins.find((p) => p.name === 'Bruno Souza')
    expect(pin).toBeDefined()
    await act(async () => {
      pin?.onClick()
    })
    expect(h.navigations).toEqual(['/alerts/w2/rescue'])
    expect(screen.queryByTestId('rescue-pick-hint')).toBeNull()
  })

  it('com o cartão aberto, "Rota de socorro" fecha o cartão e o pino segue para o socorro', async () => {
    await renderAlerts('/alerts/w1')
    expect(await screen.findByTestId('alerts-selected-worker')).toBeTruthy()
    await waitFor(() => expect(h.pins).toHaveLength(2))

    await act(async () => {
      fireEvent.click(screen.getByText('Rota de socorro'))
    })
    expect(h.navigations).toEqual(['/alerts'])

    const pin = h.pins.find((p) => p.name === 'Bruno Souza')
    expect(pin).toBeDefined()
    await act(async () => {
      pin?.onClick()
    })
    expect(h.navigations).toEqual(['/alerts', '/alerts/w2/rescue'])
  })

  it('clique no mapa vazio cancela a escolha sem navegar', async () => {
    await renderAlerts()
    await waitFor(() => expect(h.pins).toHaveLength(2))
    await act(async () => {
      fireEvent.click(screen.getByText('Rota de socorro'))
    })

    await act(async () => {
      clickMapAt(-46.7, -23.6)
    })

    expect(h.navigations).toEqual([])
    expect(screen.queryByTestId('rescue-pick-hint')).toBeNull()
    expect(screen.getByText('Rota de socorro')).toBeTruthy()
  })

  it('"Cancelar" no grupo de socorro sai da escolha', async () => {
    await renderAlerts()
    await act(async () => {
      fireEvent.click(screen.getByText('Rota de socorro'))
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Cancelar'))
    })
    expect(screen.queryByTestId('rescue-pick-hint')).toBeNull()
  })

  it('durante uma evacuação ativa, a rota de socorro continua disponível', async () => {
    h.evacuation = { acked: 0, total: 2, workers: [] }
    await renderAlerts()
    await waitFor(() => expect(h.pins).toHaveLength(2))
    await act(async () => {
      fireEvent.click(screen.getByText('Rota de socorro'))
    })
    const pin = h.pins.find((p) => p.name === 'Ana Lima')
    expect(pin).toBeDefined()
    await act(async () => {
      pin?.onClick()
    })
    expect(h.navigations).toEqual(['/alerts/w1/rescue'])
  })
})

describe('AlertsList: desenho da área', () => {
  it('clique em pino durante o desenho não abre o cartão', async () => {
    await renderAlerts()
    await waitFor(() => expect(h.pins).toHaveLength(2))
    await act(async () => {
      fireEvent.click(screen.getByText('Iniciar evacuação'))
    })

    await act(async () => {
      h.pins[0]?.onClick()
    })

    expect(h.navigations).toEqual([])
  })

  it('iniciar a evacuação no meio da escolha de socorro encerra a escolha', async () => {
    await renderAlerts()
    await act(async () => {
      fireEvent.click(screen.getByText('Rota de socorro'))
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Iniciar evacuação'))
    })
    expect(screen.queryByTestId('rescue-pick-hint')).toBeNull()
  })
})
