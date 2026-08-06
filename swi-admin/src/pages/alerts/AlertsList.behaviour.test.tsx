// Comportamento da tela de alertas: filtros, busca, evacuação real e as três
// camadas do mapa. O smoke vizinho (AlertsList.test.tsx) só garante que a
// página monta; tudo que decide o que aparece no mapa mora aqui.
//
// O maplibre é substituído por um dublê porque o jsdom não tem WebGL: sem isso
// `mapReady` nunca vira true e nenhum dos efeitos de camada roda, que é
// exatamente a parte da tela que precisa de teste.
import { act, screen, fireEvent, waitFor } from '@testing-library/react'
import { AlertsList } from './AlertsList'
import { clearSession, renderPage } from '@/test-utils/renderPage'

const h = vi.hoisted(() => ({
  positions: [] as Array<Record<string, unknown>>,
  evacuation: null as null | {
    acked: number
    total: number
    workers: Array<{ id: string; acked: boolean }>
  },
  evacError: null as string | null,
  start: vi.fn(async () => {}),
  end: vi.fn(async () => {}),
  navigations: [] as string[],
  // Cada pino criado: guarda o status pedido e o onClick, para provar a cor do
  // ACK durante evacuação e a navegação por clique sem depender do DOM interno
  // do maplibre.
  pins: [] as Array<{ status: unknown; name: unknown; onClick: () => void }>,
  radar: null as null | { host: string; path: string },
}))

vi.mock('@/hooks/useLivePositions', () => ({ useLivePositions: () => h.positions }))
vi.mock('@/hooks/useEvacuation', () => ({
  useEvacuation: () => ({
    evacuation: h.evacuation,
    error: h.evacError,
    start: h.start,
    end: h.end,
  }),
}))
vi.mock('@/lib/rainViewer', () => ({ getRainViewerLatestRadar: async () => h.radar }))
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

// Dublê do maplibre. `map.on('load')` dispara na hora: no runtime real o load
// chega depois do fetch dos tiles, e o que a tela faz a partir dele é o que
// interessa aqui.
const mapState = {
  layers: new Set<string>(),
  sources: new Set<string>(),
  handlers: {} as Record<string, Array<() => void>>,
  removed: false,
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
    project: () => ({ x: 100, y: 200 }),
    getLayer: (id: string) => (mapState.layers.has(id) ? { id } : undefined),
    getSource: (id: string) => (mapState.sources.has(id) ? { id } : undefined),
    addLayer: ({ id }: { id: string }) => mapState.layers.add(id),
    addSource: (id: string) => mapState.sources.add(id),
    removeLayer: (id: string) => mapState.layers.delete(id),
    removeSource: (id: string) => mapState.sources.delete(id),
    fitBounds: () => {},
    remove: () => {
      mapState.removed = true
    },
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

// A lib precisa ser ESTÁVEL entre renders: `useMapLibre` entra nas deps do
// efeito que cria o mapa, então devolver um objeto novo a cada render faria a
// tela destruir e recriar o mapa sem parar, e a guarda `mapRef.current !== map`
// dos cleanups nunca casaria.
let currentLib: ReturnType<typeof makeLib>

vi.mock('@/lib/useMapLibre', () => ({ useMapLibre: () => currentLib }))

const worker = (over: Record<string, unknown> = {}) => ({
  id: 'w1',
  name: 'Ana Lima',
  lat: -23.55,
  lng: -46.63,
  status: 'good',
  avatarUri: '',
  ...over,
})

const renderAlerts = (route = '/alerts') =>
  renderPage(<AlertsList />, { route, path: '/alerts/:employeeId?' })

beforeEach(() => {
  h.positions = [worker(), worker({ id: 'w2', name: 'Bruno Souza', status: 'low' })]
  h.evacuation = null
  h.evacError = null
  h.navigations = []
  h.pins = []
  h.radar = null
  h.start.mockClear()
  h.end.mockClear()
  mapState.layers.clear()
  mapState.sources.clear()
  mapState.handlers = {}
  mapState.removed = false
  currentLib = makeLib()
})

afterEach(clearSession)

describe('AlertsList: filtros e busca', () => {
  it('sem filtro, cria um pino por trabalhador', async () => {
    await renderAlerts()
    await waitFor(() => expect(h.pins).toHaveLength(2))
  })

  it('o chip de urgência médica deixa só o trabalhador em estado low', async () => {
    await renderAlerts()
    await waitFor(() => expect(h.pins).toHaveLength(2))
    h.pins = []

    await act(async () => {
      fireEvent.click(screen.getByText('Urgência médica'))
    })

    await waitFor(() => expect(h.pins.map((p) => p.name)).toEqual(['Bruno Souza']))
  })

  it('o chip "Sem incidentes" deixa só o trabalhador good', async () => {
    await renderAlerts()
    await waitFor(() => expect(h.pins).toHaveLength(2))
    h.pins = []

    await act(async () => {
      fireEvent.click(screen.getByText('Sem incidentes'))
    })

    await waitFor(() => expect(h.pins.map((p) => p.name)).toEqual(['Ana Lima']))
  })
})

describe('AlertsList: evacuação real', () => {
  it('sem evacuação ativa, o botão dispara o início', async () => {
    await renderAlerts()

    await act(async () => {
      fireEvent.click(screen.getByText('Iniciar evacuação'))
    })

    expect(h.start).toHaveBeenCalledTimes(1)
  })

  it('com evacuação ativa, mostra o progresso X/N e encerra', async () => {
    h.evacuation = {
      acked: 1,
      total: 2,
      workers: [
        { id: 'w1', acked: true },
        { id: 'w2', acked: false },
      ],
    }
    await renderAlerts()

    expect(screen.getByTestId('evacuation-banner')).toBeTruthy()
    expect(screen.getByText(/1\/2 confirmados/)).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByText('Encerrar evacuação'))
    })

    expect(h.end).toHaveBeenCalledTimes(1)
  })

  it('durante a evacuação, a borda do pino reflete o ACK e não os vitais', async () => {
    h.evacuation = {
      acked: 1,
      total: 2,
      workers: [
        { id: 'w1', acked: true },
        { id: 'w2', acked: false },
      ],
    }
    await renderAlerts()

    await waitFor(() => expect(h.pins).toHaveLength(2))
    // w1 confirmou → good; w2 ainda não → alert, mesmo tendo vitais 'low'.
    expect(h.pins.map((p) => p.status)).toEqual(['good', 'alert'])
  })

  it('erro da evacuação aparece na tela', async () => {
    h.evacError = 'Falha ao iniciar evacuação'
    await renderAlerts()
    expect(screen.getByText('Falha ao iniciar evacuação')).toBeTruthy()
  })
})

describe('AlertsList: camadas do mapa', () => {
  it('modo calor adiciona a camada e desligar remove', async () => {
    await renderAlerts()

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Mapa de calor'))
    })
    await waitFor(() => expect(mapState.layers.has('heatmap-layer')).toBe(true))

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Mapa de calor'))
    })
    await waitFor(() => expect(mapState.layers.has('heatmap-layer')).toBe(false))
  })

  it('modo meteo adiciona a camada de radar quando o RainViewer responde', async () => {
    h.radar = { host: 'https://radar.exemplo', path: '/v2/radar/000' }
    await renderAlerts()

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Mapa meteorológico'))
    })

    await waitFor(() => expect(mapState.layers.has('meteo-layer')).toBe(true))
  })

  it('RainViewer sem resposta não adiciona camada nenhuma', async () => {
    h.radar = null
    await renderAlerts()

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Mapa meteorológico'))
    })

    await waitFor(() => expect(mapState.layers.has('meteo-layer')).toBe(false))
  })
})

describe('AlertsList: seleção de pino', () => {
  it('clicar num pino navega para o detalhe dele', async () => {
    await renderAlerts()
    await waitFor(() => expect(h.pins).toHaveLength(2))

    await act(async () => {
      h.pins[0]?.onClick()
    })

    expect(h.navigations).toEqual(['/alerts/w1'])
  })

  it('com um pino selecionado, o cartão do colaborador aparece', async () => {
    await renderAlerts('/alerts/w1')
    expect(await screen.findByText('Criar rota de socorro')).toBeTruthy()
  })

  it('no basemap meteo, pino vermelho troca o cartão pelo alerta de chuva', async () => {
    await renderAlerts('/alerts/w2')

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Mapa meteorológico'))
    })

    expect(await screen.findByText('Alerta de Chuvas intensas')).toBeTruthy()
    expect(screen.queryByText('Criar rota de socorro')).toBeNull()
  })

  it('o botão "Evacuar área" do alerta de chuva dispara evacuação real', async () => {
    await renderAlerts('/alerts/w2')

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Mapa meteorológico'))
    })
    await act(async () => {
      fireEvent.click(await screen.findByText('Evacuar área'))
    })

    expect(h.start).toHaveBeenCalledTimes(1)
  })
})
