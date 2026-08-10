// Smoke test — verifies the page mounts without throwing under the
// providers it expects at runtime (theme + auth + router). Behavioural
// assertions live in dedicated tests; this guard catches regressions
// from DS bumps, route refactors, and import-graph changes.
// vitest globals (describe/it/expect/afterEach) are available via globals: true
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AuthProvider } from '@/hooks/useAuth'
import { CAMERA_LOCATIONS } from '@/services/cameras'
import { MapsGeneral } from './MapsGeneral'
import { clearSession, renderPage, seedSession, settled } from '@/test-utils/renderPage'

// Posições live têm suite própria (useLivePositions.test); o smoke não deve
// abrir fetch/socket reais no jsdom.
//
// O valor sai de um holder mutável pra que cada teste escolha seu cenário. A
// identidade do array é ESTÁVEL entre renders (como o useState do hook real),
// senão os efeitos de pino se reconstruiriam a cada render e a contagem de
// marcadores viraria ruído. Trocar `live.value` por um array novo é o que
// simula um heartbeat do WebSocket.
const live = vi.hoisted(() => ({
  value: [
    { id: 'w1', name: 'A', lat: -23.55, lng: -46.63, status: 'good', avatarUri: '' },
  ] as Array<Record<string, unknown>> | null,
}))
vi.mock('@/hooks/useLivePositions', () => ({ useLivePositions: () => live.value }))

// Radar externo: por padrão resolve null pra não abrir rede. O efeito de "Zonas
// de alerta" sai cedo do .then, MAS ainda registra o cleanup, que é onde mora o
// bug do Web #8. Os testes do caminho feliz trocam `radar.value`.
const radar = vi.hoisted(() => ({ value: null as { host: string; path: string } | null }))
vi.mock('@/lib/rainViewer', () => ({ getRainViewerLatestRadar: async () => radar.value }))

// Sem o provider real, useDemoToast devolve um no-op com identidade NOVA a cada
// chamada, o que faria o efeito das câmeras reexecutar a cada render. O espião
// é estável, como o useCallback do provider de verdade.
const toast = vi.hoisted(() => ({ show: vi.fn() }))
vi.mock('@/lib/demoToast', () => ({ useDemoToast: () => toast }))

// Stub do maplibre que modela o contrato REAL da lib: remove() destrói o style,
// e qualquer getLayer/getSource depois disso lança. Sem modelar isso o teste
// não enxerga a tela preta, porque um stub permissivo aceitaria a chamada
// pós-remove em silêncio.
//
// getLayer/getSource respondem pelo que foi de fato adicionado. Um stub que
// devolvesse sempre undefined nunca deixaria o `if (map.getLayer(...))` dos
// cleanups chamar removeLayer, e a limpeza de camada ficaria sem cobertura.
const maplibre = vi.hoisted(() => {
  // Compartilhados entre instâncias: o teste do Web #3 precisa observar o voo
  // sem depender de qual instância de mapa foi construída.
  const flyTo = vi.fn()
  const fitBounds = vi.fn()
  const addSource = vi.fn()
  const addLayer = vi.fn()
  const removeSource = vi.fn()
  const removeLayer = vi.fn()

  const makeMap = () => {
    let removed = false
    const layers = new Set<string>()
    const sources = new Set<string>()
    const assertLive = () => {
      if (removed) throw new TypeError("Cannot read properties of undefined (reading 'getLayer')")
    }
    return {
      on: (event: string, cb: () => void) => {
        // 'load' síncrono para o componente chegar a mapReady sem timers.
        if (event === 'load') cb()
      },
      getLayer: (id: string) => {
        assertLive()
        return layers.has(id) ? { id } : undefined
      },
      getSource: (id: string) => {
        assertLive()
        return sources.has(id) ? { id } : undefined
      },
      addLayer: (spec: { id: string }) => {
        addLayer(spec)
        layers.add(spec.id)
      },
      addSource: (id: string, spec: unknown) => {
        addSource(id, spec)
        sources.add(id)
      },
      removeLayer: (id: string) => {
        removeLayer(id)
        layers.delete(id)
      },
      removeSource: (id: string) => {
        removeSource(id)
        sources.delete(id)
      },
      fitBounds,
      flyTo,
      remove: () => {
        removed = true
      },
    }
  }

  // Cada marcador construído fica registrado: o elemento (pra disparar o clique
  // do pino), as coordenadas recebidas (pra provar a re-âncora por geolocalização)
  // e os handlers de drag do pino azul de "Minha localização".
  type MarkerRecord = {
    element: HTMLElement | null
    draggable: boolean
    lngLats: Array<[number, number]>
    removed: boolean
    handlers: Record<string, () => void>
  }
  const markers: MarkerRecord[] = []
  const makeMarker = (opts?: { element?: HTMLElement; draggable?: boolean }) => {
    const rec: MarkerRecord = {
      element: opts?.element ?? null,
      draggable: opts?.draggable ?? false,
      lngLats: [],
      removed: false,
      handlers: {},
    }
    markers.push(rec)
    const marker = {
      setLngLat: (v: [number, number]) => {
        rec.lngLats.push(v)
        return marker
      },
      addTo: () => marker,
      remove: () => {
        rec.removed = true
      },
      getElement: () => rec.element ?? document.createElement('div'),
      on: (event: string, cb: () => void) => {
        rec.handlers[event] = cb
        return marker
      },
      getLngLat: () => {
        const last = rec.lngLats[rec.lngLats.length - 1]
        return { lng: last?.[0] ?? 0, lat: last?.[1] ?? 0 }
      },
    }
    return marker
  }

  const lib = {
    // As opções são declaradas mesmo sem uso no corpo: é por elas que os testes
    // afirmam com que centro o mapa nasceu.
    Map: vi.fn((_options: { center: [number, number] }) => makeMap()),
    Marker: vi.fn((opts?: { element?: HTMLElement; draggable?: boolean }) => makeMarker(opts)),
    LngLatBounds: vi.fn(() => ({ extend: () => {} })),
  }
  const reset = () => {
    const spies = [
      flyTo,
      fitBounds,
      addSource,
      addLayer,
      removeSource,
      removeLayer,
      lib.Map,
      lib.Marker,
    ]
    spies.forEach((spy) => spy.mockClear())
    markers.length = 0
  }
  return { lib, flyTo, fitBounds, addSource, addLayer, removeSource, removeLayer, markers, reset }
})
vi.mock('@/lib/useMapLibre', () => ({ useMapLibre: () => maplibre.lib }))

const flyToSpy = maplibre.flyTo

// Posição padrão: um operador exatamente em MOCK_ORIGIN. Os testes que precisam
// exercitar o deslocamento por SHIFT_SCALE trocam por alguém fora da âncora,
// senão o cálculo devolveria a própria origem e passaria mesmo se estivesse errado.
const W1 = { id: 'w1', name: 'A', lat: -23.55, lng: -46.63, status: 'good', avatarUri: '' }

// Espião de geolocalização: o jsdom não implementa navigator.geolocation, então
// a propriedade é definida por teste. `configurable` para poder redefinir.
const geolocation = { getCurrentPosition: vi.fn() }

function EmployeeProbe() {
  const { id } = useParams<{ id: string }>()
  return <div data-testid="employee-route">{id}</div>
}

/**
 * Monta a página com uma TABELA de rotas, ao contrário do `renderPage`, que
 * monta um componente só. Os quatro testes originais não precisavam disso;
 * provar para onde o clique de um pino navega, sim.
 */
async function renderMaps(route = '/maps/general') {
  seedSession()
  return settled(
    render(
      <SwiThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[route]}>
            <Routes>
              <Route path="/maps/general" element={<MapsGeneral />} />
              <Route path="/" element={<div data-testid="dashboard-route" />} />
              <Route path="/employees/:id" element={<EmployeeProbe />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </SwiThemeProvider>,
    ),
  )
}

/** Um turno de macrotask dentro de act: o radar encadeia .then e o mapa agenda
 *  trabalho no tick seguinte. Sem isso a atualização cai no teste seguinte. */
async function drain() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

/** Pinos de conteúdo (operador/câmera): têm elemento próprio. O pino azul da
 *  geolocalização é `draggable` e é filtrado fora. */
function contentPins() {
  return maplibre.markers.filter((m) => !m.draggable)
}

/** Coordenada esperada dentro da lista. A folga de 1e-6 absorve o erro de
 *  ponto flutuante da re-âncora (ordem de 1e-15) e ainda distingue com sobra
 *  os deslocamentos em jogo, que são da ordem de 1e-3. */
function perto(coords: Array<[number, number]>, lng: number, lat: number) {
  return coords.some(([x, y]) => Math.abs(x - lng) < 1e-6 && Math.abs(y - lat) < 1e-6)
}

describe('MapsGeneral', () => {
  beforeEach(() => {
    maplibre.reset()
    toast.show.mockClear()
    geolocation.getCurrentPosition.mockReset()
    live.value = [{ ...W1 }]
    radar.value = null
    Object.defineProperty(window.navigator, 'geolocation', {
      value: geolocation,
      configurable: true,
    })
  })
  afterEach(clearSession)

  it('renders without crashing', async () => {
    const { unmount } = await renderPage(<MapsGeneral />, { route: '/maps/general' })
    expect(screen.getByTestId('maps-general')).toBeInTheDocument()
    // Desmonta DENTRO do teste: o efeito do radar externo resolve num
    // microtask encadeado e, se a limpeza ficar para o afterEach, a
    // atualização cai já durante o teste seguinte, que é onde o React acusa,
    // apontando para o teste errado.
    // Um turno de macrotask antes de desmontar: o efeito do radar externo
    // encadeia .then, e drenar so microtask deixa a ultima etapa pendente,
    // que entao resolve num root ja desmontado.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    await act(async () => {
      unmount()
    })
  })

  // QA Web #3 (30/07/2026): "ao clicar no ícone de localização para ver o
  // funcionário no mapa, é preciso um clique adicional para exibi-lo".
  //
  // Eram duas causas somadas: o pin da lista navegava para /maps/general sem
  // dizer de QUEM era, e esta tela abre com a camada de operadores desligada.
  // O usuário caía num mapa vazio. Agora `?focus=<id>` liga a camada e
  // centraliza no funcionário.
  it('com ?focus liga a camada de operadores e voa até o funcionário (QA Web #3)', async () => {
    const { unmount } = await renderPage(<MapsGeneral />, {
      route: '/maps/general?focus=w1',
    })

    // O marcador de w1 vem do mock de useLivePositions no topo do arquivo.
    await waitFor(() => expect(flyToSpy).toHaveBeenCalled())
    expect(flyToSpy.mock.calls[0]?.[0]).toMatchObject({ center: [-46.63, -23.55] })

    // A tela deixa trabalho pendente depois do voo (o radar externo encadeia
    // .then, e o mapa agenda no tick seguinte). Drenar micro + macrotask e
    // desmontar aqui mantém tudo no escopo deste teste; deixar para o
    // afterEach faz a atualização cair num root já desmontado, e o React a
    // reporta como "update to Root", sem pilha e atribuída a outro teste.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    await act(async () => {
      unmount()
    })
  })

  it('sem ?focus nao voa pra ninguem (comportamento antigo preservado)', async () => {
    await renderPage(<MapsGeneral />, { route: '/maps/general' })
    // Flush dentro de act: cru, qualquer efeito do mapa que caia neste tick
    // atualiza estado fora de escopo, e o React atribui o aviso ao teste
    // ANTERIOR, que foi onde ele apareceu.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(flyToSpy).not.toHaveBeenCalled()
  })

  // QA Web #8 (30/07/2026), BLOQUEADOR: "após habilitar os filtros do Mapa de
  // calor e clicar em um item do menu lateral, a tela fica preta".
  //
  // Causa: o React roda cleanups na ORDEM DE DECLARAÇÃO. O efeito que cria o
  // mapa é declarado antes dos que adicionam camadas, então no unmount
  // map.remove() rodava PRIMEIRO e os cleanups de heatmap e meteo chamavam
  // getLayer() num mapa já destruído. Exceção em cleanup derruba a árvore.
  //
  // Só reproduz com os filtros ligados porque, desligados, os efeitos saem
  // cedo e nem chegam a registrar cleanup. É o passo a passo do QA.
  it('não derruba a tela ao desmontar com o mapa de calor ligado (QA Web #8)', async () => {
    const view = await renderPage(<MapsGeneral />, { route: '/maps/general' })

    fireEvent.click(screen.getByRole('button', { name: 'Mapa de calor' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Produtividade' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Zonas de alerta' }))

    // Navegar pelo menu lateral desmonta a página. Se algum cleanup tocar o
    // mapa depois do remove(), isto lança e o usuário vê tela preta.
    expect(() => view.unmount()).not.toThrow()
  })

  // ---------------------------------------------------------------- mapa

  // O mapa nasce UMA vez. O gate do efeito é o booleano `markersLoaded` e o
  // centro sai de um ref justamente para isso: depender de `mapMarkers` faria
  // cada heartbeat do WebSocket (3 s) destruir e recriar o mapa. Nenhum dos
  // quatro testes acima acusaria essa troca de dependência.
  it('não recria o mapa quando chega uma posição nova', async () => {
    const view = await renderMaps()
    await waitFor(() => expect(maplibre.lib.Map).toHaveBeenCalledTimes(1))

    // Heartbeat: array NOVO com posição diferente, mais um re-render pra que a
    // página releia o hook.
    live.value = [{ ...W1, lat: -23.56 }]
    fireEvent.click(screen.getByRole('button', { name: 'Operador' }))
    await drain()

    expect(maplibre.lib.Map).toHaveBeenCalledTimes(1)
    await act(async () => {
      view.unmount()
    })
  })

  it('enquadra todos os operadores no load quando há mais de um', async () => {
    live.value = [{ ...W1 }, { ...W1, id: 'w2', lng: -46.6, lat: -23.5 }]
    const view = await renderMaps()

    await waitFor(() => expect(maplibre.fitBounds).toHaveBeenCalledTimes(1))
    expect(maplibre.fitBounds.mock.calls[0]?.[1]).toMatchObject({
      padding: 80,
      animate: false,
      maxZoom: 16,
    })
    await act(async () => {
      view.unmount()
    })
  })

  // ----------------------------------------------------------- operadores

  it('ligar Operador desenha um pino por posição e recolher os remove', async () => {
    live.value = [{ ...W1 }, { ...W1, id: 'w2', lng: -46.6, lat: -23.5 }]
    const view = await renderMaps()
    // A tela abre com a camada desligada (é o que o QA Web #3 corrigiu via ?focus).
    expect(contentPins()).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Operador' }))
    await drain()
    expect(contentPins()).toHaveLength(2)
    expect(contentPins().map((p) => p.lngLats[0])).toEqual([
      [-46.63, -23.55],
      [-46.6, -23.5],
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Recolher' }))
    await drain()
    expect(contentPins().every((p) => p.removed)).toBe(true)
    await act(async () => {
      view.unmount()
    })
  })

  it('clicar no pino do operador abre a página do funcionário', async () => {
    await renderMaps()
    fireEvent.click(screen.getByRole('button', { name: 'Operador' }))
    await drain()

    const pino = contentPins()[0]
    expect(pino?.element).toBeTruthy()
    await act(async () => {
      pino?.element?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(screen.getByTestId('employee-route')).toHaveTextContent('w1')
    await drain()
  })

  // -------------------------------------------------------------- câmeras

  it('ligar Câmeras desenha a frota inteira e o clique anuncia o stream', async () => {
    const view = await renderMaps()
    fireEvent.click(screen.getByRole('button', { name: 'Câmeras' }))
    await drain()

    // A frota vem de services/cameras, a MESMA lista que alimenta o KPI
    // "Câmeras ativas". Cravar 12 aqui deixaria o teste passar com o mapa e o
    // KPI divergindo de novo.
    expect(contentPins()).toHaveLength(CAMERA_LOCATIONS.length)
    const primeira = CAMERA_LOCATIONS[0]
    expect(contentPins()[0]?.lngLats[0]).toEqual([primeira?.lng, primeira?.lat])

    await act(async () => {
      contentPins()[0]?.element?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(toast.show).toHaveBeenCalledWith(
      'Câmera selecionada',
      `Stream ao vivo de ${primeira?.name}`,
    )
    await act(async () => {
      view.unmount()
    })
  })

  // -------------------------------------------------------------- heatmap

  it('ligar Produtividade adiciona a camada de calor e desligar a remove', async () => {
    const view = await renderMaps()
    fireEvent.click(screen.getByRole('button', { name: 'Mapa de calor' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Produtividade' }))
    await drain()

    expect(maplibre.addSource).toHaveBeenCalledWith(
      'heatmap-points',
      expect.objectContaining({ type: 'geojson' }),
    )
    expect(maplibre.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'heatmap-layer', type: 'heatmap', source: 'heatmap-points' }),
    )

    // Desligar é o OUTRO lado da guarda do Web #8: aqui o cleanup roda com o
    // mesmo mapa vivo (`mapRef.current === map`), então tem que limpar de fato.
    // O teste do unmount acima cobre o caso em que ele deve se abster.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Produtividade' }))
    await drain()
    expect(maplibre.removeLayer).toHaveBeenCalledWith('heatmap-layer')
    expect(maplibre.removeSource).toHaveBeenCalledWith('heatmap-points')
    await act(async () => {
      view.unmount()
    })
  })

  // ----------------------------------------------------------------- meteo

  // As duas decisões que já custaram bug: usar o `path` (hash) do manifesto em
  // vez do `time` (URL expira em ~24 h) e limitar maxzoom em 7 (acima disso o
  // RainViewer devolve um PNG de "zoom não suportado").
  it('com radar disponível, monta o raster pelo hash do manifesto e limita o zoom em 7', async () => {
    radar.value = { host: 'https://tiles.example', path: '/v2/radar/abc123' }
    const view = await renderMaps()
    fireEvent.click(screen.getByRole('button', { name: 'Mapa de calor' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Zonas de alerta' }))

    await waitFor(() => expect(maplibre.addSource).toHaveBeenCalledWith('meteo', expect.anything()))
    const spec = maplibre.addSource.mock.calls.find((c) => c[0] === 'meteo')?.[1]
    expect(spec).toMatchObject({
      type: 'raster',
      tiles: ['https://tiles.example/v2/radar/abc123/256/{z}/{x}/{y}/2/1_1.png'],
      tileSize: 256,
      maxzoom: 7,
    })
    expect(maplibre.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'meteo-layer', type: 'raster' }),
    )
    await drain()
    await act(async () => {
      view.unmount()
    })
  })

  // ------------------------------------------------------- geolocalização

  // "Minha localização" não só voa: re-ancora TODO o dataset de demo em volta
  // do usuário, deslocando cada coordenada por (geoloc - MOCK_ORIGIN) * 0.2.
  // O operador de teste fica FORA da âncora de propósito: em cima dela o
  // resultado seria a própria posição do usuário e o fator de escala poderia
  // estar errado sem o teste perceber.
  it('minha localização re-ancora operadores e câmeras em volta do usuário', async () => {
    live.value = [{ ...W1, id: 'w2', lng: -46.6, lat: -23.5 }]
    geolocation.getCurrentPosition.mockImplementation((ok: PositionCallback) =>
      ok({ coords: { longitude: -50, latitude: -10 } } as GeolocationPosition),
    )
    const view = await renderMaps()
    fireEvent.click(screen.getByRole('button', { name: 'Operador' }))
    fireEvent.click(screen.getByRole('button', { name: 'Câmeras' }))
    await drain()
    const antes = contentPins().length

    fireEvent.click(screen.getByRole('button', { name: 'Centralizar na minha localização' }))
    await drain()

    expect(flyToSpy).toHaveBeenCalledWith(expect.objectContaining({ center: [-50, -10], zoom: 16 }))
    const novas = contentPins()
      .slice(antes)
      .flatMap((p) => p.lngLats)
    // Operador: -50 + (-46.6 + 46.63) * 0.2 e -10 + (-23.5 + 23.55) * 0.2
    expect(perto(novas, -49.994, -9.99)).toBe(true)
    // Câmera 1: -50 + (-46.638 + 46.63) * 0.2 e -10 + (-23.541 + 23.55) * 0.2
    expect(perto(novas, -50.0016, -9.9982)).toBe(true)
    await act(async () => {
      view.unmount()
    })
  })

  it('geolocalização negada avisa e não mexe no dataset', async () => {
    geolocation.getCurrentPosition.mockImplementation(
      (_ok: PositionCallback, fail: PositionErrorCallback) =>
        fail({ message: 'Permissão negada' } as GeolocationPositionError),
    )
    const view = await renderMaps()
    fireEvent.click(screen.getByRole('button', { name: 'Operador' }))
    await drain()
    const antes = contentPins().length

    fireEvent.click(screen.getByRole('button', { name: 'Centralizar na minha localização' }))
    await drain()

    expect(toast.show).toHaveBeenCalledWith('Não foi possível localizar', 'Permissão negada')
    expect(flyToSpy).not.toHaveBeenCalled()
    expect(contentPins()).toHaveLength(antes)
    await act(async () => {
      view.unmount()
    })
  })

  it('browser sem geolocalização avisa em vez de falhar calado', async () => {
    Object.defineProperty(window.navigator, 'geolocation', {
      value: undefined,
      configurable: true,
    })
    const view = await renderMaps()

    fireEvent.click(screen.getByRole('button', { name: 'Centralizar na minha localização' }))

    expect(toast.show).toHaveBeenCalledWith(
      'Geolocalização indisponível',
      'Browser não suporta navigator.geolocation',
    )
    await drain()
    await act(async () => {
      view.unmount()
    })
  })

  // O botão fica em espera por 5 s depois de localizar. Sem isso, socar o botão
  // dispara várias permissões seguidas no browser.
  it('clicar de novo dentro da janela de espera não repete o pedido', async () => {
    geolocation.getCurrentPosition.mockImplementation((ok: PositionCallback) =>
      ok({ coords: { longitude: -50, latitude: -10 } } as GeolocationPosition),
    )
    const view = await renderMaps()

    fireEvent.click(screen.getByRole('button', { name: 'Centralizar na minha localização' }))
    await drain()
    fireEvent.click(screen.getByRole('button', { name: 'Centralizar na minha localização' }))
    await drain()

    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1)
    await act(async () => {
      view.unmount()
    })
  })

  // O pino azul existe porque a geolocalização de desktop erra por quilômetros:
  // arrastá-lo corrige a âncora e o dataset de demo acompanha.
  it('arrastar o pino azul re-ancora o dataset na posição corrigida', async () => {
    live.value = [{ ...W1, id: 'w2', lng: -46.6, lat: -23.5 }]
    geolocation.getCurrentPosition.mockImplementation((ok: PositionCallback) =>
      ok({ coords: { longitude: -50, latitude: -10 } } as GeolocationPosition),
    )
    const view = await renderMaps()
    fireEvent.click(screen.getByRole('button', { name: 'Operador' }))
    fireEvent.click(screen.getByRole('button', { name: 'Centralizar na minha localização' }))
    await drain()

    const azul = maplibre.markers.find((m) => m.draggable)
    expect(azul).toBeTruthy()
    const antes = contentPins().length

    // O elemento troca de cursor durante o arrasto — é o único retorno visual
    // de que o pino está sendo movido.
    await act(async () => {
      azul?.handlers['dragstart']?.()
    })
    expect(azul?.element?.style.cursor).toBe('grabbing')

    // A lib guarda a posição final do arrasto; o dublê a recebe por setLngLat.
    azul?.lngLats.push([-40, -20])
    await act(async () => {
      azul?.handlers['dragend']?.()
    })
    await drain()

    expect(azul?.element?.style.cursor).toBe('grab')
    const novas = contentPins()
      .slice(antes)
      .flatMap((p) => p.lngLats)
    // Operador re-ancorado: -40 + (-46.6 + 46.63) * 0.2 e -20 + (-23.5 + 23.55) * 0.2
    expect(perto(novas, -39.994, -19.99)).toBe(true)
    await act(async () => {
      view.unmount()
    })
  })

  // ------------------------------------------------------------ sem posições

  it('sem nenhum operador, o mapa abre na âncora padrão e não enquadra nada', async () => {
    live.value = []
    const view = await renderMaps()

    await waitFor(() => expect(maplibre.lib.Map).toHaveBeenCalledTimes(1))
    expect(maplibre.lib.Map.mock.calls[0]?.[0]).toMatchObject({ center: [-46.63, -23.55] })
    expect(maplibre.fitBounds).not.toHaveBeenCalled()
    await drain()
    await act(async () => {
      view.unmount()
    })
  })

  it('com um único operador, centraliza nele sem enquadrar', async () => {
    live.value = [{ ...W1 }]
    const view = await renderMaps()

    await waitFor(() => expect(maplibre.lib.Map).toHaveBeenCalledTimes(1))
    expect(maplibre.lib.Map.mock.calls[0]?.[0]).toMatchObject({ center: [-46.63, -23.55] })
    expect(maplibre.fitBounds).not.toHaveBeenCalled()
    await drain()
    await act(async () => {
      view.unmount()
    })
  })

  it('radar indisponível não monta camada meteorológica nenhuma', async () => {
    radar.value = null
    const view = await renderMaps()

    fireEvent.click(screen.getByRole('button', { name: 'Mapa de calor' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Zonas de alerta' }))
    await drain()

    expect(maplibre.addSource.mock.calls.some((c) => c[0] === 'meteo')).toBe(false)
    await act(async () => {
      view.unmount()
    })
  })

  // ------------------------------------------------------- botão arrastável

  it('tocar no botão Voltar leva ao dashboard', async () => {
    await renderMaps()
    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao dashboard' }))
    expect(screen.getByTestId('dashboard-route')).toBeInTheDocument()
    await drain()
  })

  // O botão é arrastável, e o PanResponder distingue toque (sem movimento além
  // de 3 px, navega) de arrasto (reposiciona e NÃO navega). A asserção de que a
  // âncora mudou é o que impede este teste de passar à toa: se o responder não
  // engatasse, `right` continuaria no valor inicial e a ausência de navegação
  // não provaria nada.
  it('arrastar o botão Voltar reposiciona sem navegar', async () => {
    await renderMaps()
    const alvo = screen.getByTestId('back-to-dashboard-drag')
    expect(alvo).toBeTruthy()
    expect(alvo?.style.right).toBe('20px')
    expect(alvo?.style.bottom).toBe('30px')

    fireEvent.mouseDown(alvo as Element, { clientX: 300, clientY: 400, button: 0 })
    fireEvent.mouseMove(alvo as Element, { clientX: 240, clientY: 360, button: 0 })
    fireEvent.mouseUp(alvo as Element, { clientX: 240, clientY: 360, button: 0 })

    // A âncora é invertida nos dois eixos: arrastar 60 px pra esquerda AUMENTA
    // `right` em 60, e 40 px pra cima aumenta `bottom` em 40.
    expect(alvo?.style.right).toBe('80px')
    expect(alvo?.style.bottom).toBe('70px')
    expect(screen.queryByTestId('dashboard-route')).not.toBeInTheDocument()
    expect(screen.getByTestId('maps-general')).toBeInTheDocument()
    await drain()
  })
})
