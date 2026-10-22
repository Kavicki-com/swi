// Pedido de ajuda do app na tela de alertas: o pino de quem pediu sai como o
// alerta urgente do desenho (badge vermelho), maior e por cima dos outros, e o
// cartão sobre o pino diz "Pedido de ajuda" com a ação "Criar rota de socorro"
// que já leva ao fluxo de resgates. A leitura vem de admin/workers (dublê).
//
// O maplibre é dublê pelo mesmo motivo do AlertsList.behaviour.test.tsx: o
// jsdom não tem WebGL e sem isso nenhum pino nasce.
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { AlertsList } from './AlertsList'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import type { AdminHelpRequest, AdminWorkersTelemetry } from '@/services/api/telemetry'
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
  pins: [] as Array<{ status: unknown; name: unknown; size: unknown }>,
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
  createPinElement: ({ content }: { content: { props: Record<string, unknown> } }) => {
    h.pins.push({
      status: content.props.status,
      name: content.props.name,
      size: content.props.size,
    })
    return { el: document.createElement('div'), root: { unmount: () => {} } }
  },
}))

function makeLib() {
  const map = {
    on: (ev: string, cb: () => void) => {
      if (ev === 'load') cb()
    },
    off: () => {},
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
  class Marker {
    setLngLat() {
      return this
    }
    addTo() {
      return this
    }
    remove() {}
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

const helpRequest = (over: Partial<AdminHelpRequest> = {}): AdminHelpRequest => ({
  id: 'a-help',
  status: 'OPEN',
  createdAt: FIXTURE_AT,
  rescueId: null,
  ...over,
})

// Como o backend manda: quem pediu ajuda vem primeiro. Bruno pediu e está com
// leitura boa (o pedido não é medição); Ana não pediu.
const telemetryWith = (help: AdminHelpRequest | null): AdminWorkersTelemetry => ({
  observedAt: FIXTURE_AT,
  workers: [
    adminWorker('w2', 'Bruno Souza', { helpRequest: help }),
    adminWorker('w1', 'Ana Lima', { helpRequest: null }),
  ],
})

const renderAlerts = (route = '/alerts') =>
  renderPage(<AlertsList />, { route, path: '/alerts/:employeeId?' })

beforeEach(() => {
  h.positions = [position('w2', 'Bruno Souza'), position('w1', 'Ana Lima')]
  h.workers = telemetryWith(helpRequest())
  h.evacuation = null
  h.navigations = []
  h.pins = []
  currentLib = makeLib()
})

afterEach(clearSession)

describe('AlertsList: pino do pedido de ajuda', () => {
  it('sai vermelho, maior que os outros e por último (por cima)', async () => {
    await renderAlerts()
    await waitFor(() => expect(h.pins).toHaveLength(2))

    const [first, last] = h.pins
    expect(first!.name).toBe('Ana Lima')
    expect(first!.status).toBe('good')
    expect(last!.name).toBe('Bruno Souza')
    expect(last!.status).toBe('low')
    expect(Number(last!.size)).toBeGreaterThan(Number(first!.size ?? 40))
  })

  it('entra no filtro de urgência médica mesmo com a leitura boa', async () => {
    await renderAlerts()
    await waitFor(() => expect(h.pins).toHaveLength(2))
    h.pins = []
    await act(async () => {
      fireEvent.click(screen.getByText('Urgência médica'))
    })
    await waitFor(() => expect(h.pins.map((p) => p.name)).toEqual(['Bruno Souza']))
  })

  it('durante a evacuação continua vermelho, sem virar a cor da confirmação', async () => {
    h.evacuation = { acked: 0, total: 2, workers: [{ id: 'w2', acked: true }] }
    await renderAlerts()
    await waitFor(() => expect(h.pins).toHaveLength(2))
    expect(h.pins.find((p) => p.name === 'Bruno Souza')!.status).toBe('low')
  })

  it('pedido atendido segue destacado até fechar', async () => {
    h.workers = telemetryWith(helpRequest({ status: 'ATTENDED', rescueId: 'r1' }))
    await renderAlerts()
    await waitFor(() => expect(h.pins).toHaveLength(2))
    expect(h.pins.find((p) => p.name === 'Bruno Souza')!.status).toBe('low')
  })

  it('sem pedido, o pino segue a cor da leitura', async () => {
    h.workers = telemetryWith(null)
    await renderAlerts()
    await waitFor(() => expect(h.pins).toHaveLength(2))
    expect(h.pins.find((p) => p.name === 'Bruno Souza')!.status).toBe('good')
  })
})

describe('AlertsList: cartão do pedido de ajuda', () => {
  it('diz "Pedido de ajuda" e "Criar rota de socorro" leva ao fluxo de resgates', async () => {
    await renderAlerts('/alerts/w2')
    expect(await screen.findByTestId('alerts-selected-worker')).toBeTruthy()
    expect(screen.getByTestId('alerts-help-request').textContent).toContain('Pedido de ajuda')

    await act(async () => {
      fireEvent.click(screen.getByText('Criar rota de socorro'))
    })
    expect(h.navigations).toContain('/alerts/w2/rescue')
  })

  it('quem não pediu ajuda não leva o rótulo', async () => {
    await renderAlerts('/alerts/w1')
    expect(await screen.findByTestId('alerts-selected-worker')).toBeTruthy()
    expect(screen.queryByTestId('alerts-help-request')).toBeNull()
    expect(screen.queryByText('Pedido de ajuda')).toBeNull()
  })
})
