// Comportamento da rota de socorro: de onde saem as duas pontas, o que a tela
// desenha em cada estado da Directions API e o que o despacho muda.
//
// Como na suíte de AlertsList, o maplibre é substituído por um dublê porque o
// jsdom não tem WebGL: sem isso `mapReady` nunca vira true e nenhum dos efeitos
// de camada, pino ou label roda, que é justamente o que precisa de teste.
import { act, screen, fireEvent, waitFor } from '@testing-library/react'
import { AlertsRescueRoute } from './AlertsRescueRoute'
import { clearSession, renderPage } from '@/test-utils/renderPage'

type LngLat = [number, number]

const h = vi.hoisted(() => ({
  positions: null as null | Array<{ id: string; lat: number; lng: number }>,
  route: null as null | {
    duration: number
    distance: number
    geometry: { coordinates: Array<[number, number]> }
  },
  loading: false,
  error: false,
  // Cada par (from, to) pedido à Directions API, para provar que as pontas
  // congelam no primeiro instante conhecido em vez de serem re-pedidas a cada
  // poll de posições.
  routeCalls: [] as Array<[unknown, unknown]>,
  toasts: [] as Array<[string, string]>,
  // Opções de cada Marker criado: `anchor` distingue o pino de crachá
  // ('bottom') do marcador de socorrista despachado ('center').
  markers: [] as Array<{ anchor?: string }>,
}))

vi.mock('@/hooks/useLivePositions', () => ({ useLivePositions: () => h.positions }))
vi.mock('@/hooks/useRescueRoute', () => ({
  useRescueRoute: (from: unknown, to: unknown) => {
    h.routeCalls.push([from, to])
    return { route: h.route, loading: h.loading, error: h.error }
  },
}))
// O `show` precisa ser estável entre renders, como o real: ele entra nas deps
// do efeito que avisa da falha, e uma função nova a cada render faria o aviso
// se repetir sozinho — a suíte mediria o dublê, não a tela.
vi.mock('@/lib/demoToast', () => {
  const show = (title: string, body: string) => {
    h.toasts.push([title, body])
  }
  return { useDemoToast: () => ({ show }) }
})
// O componente monta os pinos com createRoot num div solto. Renderizar de
// verdade traria avisos de act() por uma árvore que nenhum teste inspeciona;
// o que importa aqui é qual marcador foi criado, capturado via Marker.
vi.mock('react-dom/client', () => ({
  createRoot: () => ({ render: () => {}, unmount: () => {} }),
}))

const mapState = {
  layers: new Set<string>(),
  sources: new Set<string>(),
  paint: {} as Record<string, unknown>,
  handlers: {} as Record<string, Array<() => void>>,
  fitBounds: 0,
}

function makeLib() {
  const map = {
    on: (ev: string, cb: () => void) => {
      ;(mapState.handlers[ev] ??= []).push(cb)
      if (ev === 'load') cb()
    },
    off: (ev: string, cb: () => void) => {
      mapState.handlers[ev] = (mapState.handlers[ev] ?? []).filter((f) => f !== cb)
    },
    project: ([lng, lat]: LngLat) => ({ x: lng, y: lat }),
    getLayer: (id: string) => (mapState.layers.has(id) ? { id } : undefined),
    getSource: (id: string) => (mapState.sources.has(id) ? { id } : undefined),
    addLayer: ({ id, paint }: { id: string; paint: Record<string, unknown> }) => {
      mapState.layers.add(id)
      mapState.paint = paint
    },
    addSource: (id: string) => mapState.sources.add(id),
    removeLayer: (id: string) => mapState.layers.delete(id),
    removeSource: (id: string) => mapState.sources.delete(id),
    fitBounds: () => {
      mapState.fitBounds += 1
    },
    remove: () => {},
  }
  class Marker {
    constructor(options?: { anchor?: string }) {
      h.markers.push({ anchor: options?.anchor })
    }
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

// Instância estável entre renders: `useMapLibre` entra nas deps do efeito que
// cria o mapa, então um objeto novo a cada render faria a tela destruir e
// recriar o mapa sem parar.
let currentLib: ReturnType<typeof makeLib>

vi.mock('@/lib/useMapLibre', () => ({ useMapLibre: () => currentLib }))

const renderRoute = (query = '') =>
  renderPage(<AlertsRescueRoute />, {
    route: `/alerts/w1/rescue/w2${query}`,
    path: '/alerts/:employeeId/rescue/:rescuerId',
  })

beforeEach(() => {
  vi.clearAllMocks()
  h.positions = [
    { id: 'w1', lat: -23.55, lng: -46.63 },
    { id: 'w2', lat: -23.56, lng: -46.64 },
  ]
  h.route = {
    duration: 600,
    distance: 2500,
    geometry: {
      coordinates: [
        [-46.64, -23.56],
        [-46.635, -23.555],
        [-46.63, -23.55],
      ],
    },
  }
  h.loading = false
  h.error = false
  h.routeCalls = []
  h.toasts = []
  h.markers = []
  mapState.layers.clear()
  mapState.sources.clear()
  mapState.paint = {}
  mapState.handlers = {}
  mapState.fitBounds = 0
  currentLib = makeLib()
})

afterEach(clearSession)

// Provoca um novo render DENTRO da árvore montada. O `rerender` do RTL não
// serve: ele substitui os filhos da raiz, e a tela perderia o SwiThemeProvider
// que o `renderPage` colocou em volta. Um evento de movimento do mapa
// reposiciona os rótulos, que é uma mudança de estado real da tela.
const forceRerender = () =>
  act(async () => {
    mapState.handlers['move']?.forEach((cb) => cb())
  })

describe('AlertsRescueRoute: pontas do socorro', () => {
  it('sem posição ao vivo do par, avisa em vez de desenhar uma rota inventada', async () => {
    h.positions = [{ id: 'outro', lat: -23.5, lng: -46.6 }]
    await renderRoute()

    expect(screen.getByTestId('alerts-rescue-route-sem-posicao')).toBeTruthy()
    expect(mapState.layers.has('rescue-route-layer')).toBe(false)
  })

  it('enquanto as posições não chegaram, não avisa nem desenha', async () => {
    h.positions = null
    await renderRoute()

    expect(screen.queryByTestId('alerts-rescue-route-sem-posicao')).toBeNull()
    expect(mapState.layers.has('rescue-route-layer')).toBe(false)
  })

  it('com as duas pontas conhecidas, pede a rota do socorrista para o ferido', async () => {
    await renderRoute()

    await waitFor(() =>
      expect(h.routeCalls.at(-1)).toEqual([
        [-46.64, -23.56],
        [-46.63, -23.55],
      ]),
    )
  })

  it('as pontas congelam: mover os pinos depois não re-pede a rota', async () => {
    await renderRoute()
    await waitFor(() => expect(h.routeCalls.at(-1)?.[0]).toEqual([-46.64, -23.56]))

    h.positions = [
      { id: 'w1', lat: -23.4, lng: -46.5 },
      { id: 'w2', lat: -23.41, lng: -46.51 },
    ]
    await forceRerender()

    expect(h.routeCalls.at(-1)).toEqual([
      [-46.64, -23.56],
      [-46.63, -23.55],
    ])
  })
})

describe('AlertsRescueRoute: estados da Directions API', () => {
  it('rota resolvida vira linha opaca com os rótulos de tempo e distância', async () => {
    await renderRoute()

    await waitFor(() => expect(mapState.layers.has('rescue-route-layer')).toBe(true))
    expect(mapState.paint['line-opacity']).toBe(1.0)
    expect(screen.getByText('2.5 Km')).toBeTruthy()
    expect(screen.getByText('10 min')).toBeTruthy()
    expect(screen.getByText('4 min')).toBeTruthy()
  })

  it('carregando, a linha provisória fica esmaecida e os rótulos ficam em reticências', async () => {
    h.loading = true
    h.route = null
    await renderRoute()

    await waitFor(() => expect(mapState.layers.has('rescue-route-layer')).toBe(true))
    expect(mapState.paint['line-opacity']).toBe(0.4)
    expect(screen.getAllByText('…')).toHaveLength(3)
  })

  it('falha da rota avisa o usuário e ainda estima a distância em linha reta', async () => {
    h.error = true
    h.route = null
    await renderRoute()

    await waitFor(() => expect(h.toasts).toHaveLength(1))
    expect(h.toasts[0]?.[0]).toBe('Rota indisponível')
    expect(screen.getAllByText('—')).toHaveLength(2)
    // ~0,0141° entre as duas pontas × 111 km/° ≈ 1,6 km.
    expect(screen.getByText('1.6 Km')).toBeTruthy()
  })

  it('o aviso de falha não se repete a cada render', async () => {
    h.error = true
    h.route = null
    await renderRoute()
    await waitFor(() => expect(h.toasts).toHaveLength(1))

    await forceRerender()

    expect(h.toasts).toHaveLength(1)
  })
})

describe('AlertsRescueRoute: despacho', () => {
  it('antes do despacho: modal aberto, rota ciano e pino de crachá do socorrista', async () => {
    await renderRoute()

    expect(screen.getByText('Enviar rota de socorro')).toBeTruthy()
    await waitFor(() => expect(mapState.paint['line-color']).toBe('#2BA8C9'))
    expect(h.markers.map((m) => m.anchor)).toEqual(['bottom', 'bottom'])
  })

  it('"Continuar" fecha o modal e registra o despacho na URL', async () => {
    await renderRoute()

    await act(async () => {
      fireEvent.click(screen.getByText('Continuar'))
    })

    expect(screen.queryByText('Enviar rota de socorro')).toBeNull()
    await waitFor(() => expect(mapState.paint['line-color']).toBe('#8B5CF6'))
  })

  it('recarregar já despachado abre sem modal, com rota violeta e marcador em movimento', async () => {
    await renderRoute('?dispatched=true')

    expect(screen.queryByText('Enviar rota de socorro')).toBeNull()
    await waitFor(() => expect(mapState.paint['line-color']).toBe('#8B5CF6'))
    expect(h.markers.map((m) => m.anchor)).toEqual(['center', 'bottom'])
  })
})

describe('AlertsRescueRoute: enquadramento e rótulos', () => {
  it('enquadra as duas pontas ao carregar o mapa', async () => {
    await renderRoute()
    await waitFor(() => expect(mapState.fitBounds).toBe(1))
  })

  it('mover o mapa reposiciona os rótulos', async () => {
    await renderRoute()
    await waitFor(() => expect(mapState.handlers['move']?.length).toBeGreaterThan(0))

    await act(async () => {
      mapState.handlers['move']?.forEach((cb) => cb())
    })

    expect(screen.getByText('2.5 Km')).toBeTruthy()
  })
})
