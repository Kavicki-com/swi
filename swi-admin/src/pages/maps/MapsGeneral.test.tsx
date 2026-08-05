// Smoke test — verifies the page mounts without throwing under the
// providers it expects at runtime (theme + auth + router). Behavioural
// assertions live in dedicated tests; this guard catches regressions
// from DS bumps, route refactors, and import-graph changes.
// vitest globals (describe/it/expect/afterEach) are available via globals: true
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { MapsGeneral } from './MapsGeneral'
import { clearSession, renderPage } from '@/test-utils/renderPage'

// Posições live têm suite própria (useLivePositions.test); o smoke não deve
// abrir fetch/socket reais no jsdom.
vi.mock('@/hooks/useLivePositions', () => ({
  useLivePositions: () => [
    { id: 'w1', name: 'A', lat: -23.55, lng: -46.63, status: 'good', avatarUri: '' },
  ],
}))

// Radar externo: resolve null pra não abrir rede. O efeito de "Zonas de alerta"
// sai cedo do .then, MAS ainda registra o cleanup, que é onde mora o bug.
vi.mock('@/lib/rainViewer', () => ({ getRainViewerLatestRadar: async () => null }))

// Stub do maplibre que modela o contrato REAL da lib: remove() destrói o style,
// e qualquer getLayer/getSource depois disso lança. Sem modelar isso o teste
// não enxerga a tela preta, porque um stub permissivo aceitaria a chamada
// pós-remove em silêncio.
const maplibre = vi.hoisted(() => {
  // Compartilhado entre instâncias: o teste do Web #3 precisa observar o voo
  // sem depender de qual instância de mapa foi construída.
  const flyTo = vi.fn()
  const makeMap = () => {
    let removed = false
    const assertLive = () => {
      if (removed) throw new TypeError("Cannot read properties of undefined (reading 'getLayer')")
    }
    return {
      on: (event: string, cb: () => void) => {
        // 'load' síncrono para o componente chegar a mapReady sem timers.
        if (event === 'load') cb()
      },
      getLayer: () => {
        assertLive()
        return undefined
      },
      getSource: () => {
        assertLive()
        return undefined
      },
      addLayer: () => {},
      addSource: () => {},
      removeLayer: () => {},
      removeSource: () => {},
      fitBounds: () => {},
      flyTo,
      remove: () => {
        removed = true
      },
    }
  }
  const makeMarker = () => {
    const marker: Record<string, unknown> = {}
    marker.setLngLat = () => marker
    marker.addTo = () => marker
    marker.remove = () => {}
    marker.getElement = () => document.createElement('div')
    return marker
  }
  const lib = {
    Map: vi.fn(() => makeMap()),
    Marker: vi.fn(() => makeMarker()),
    LngLatBounds: vi.fn(() => ({ extend: () => {} })),
  }
  return { lib, flyTo }
})
vi.mock('@/lib/useMapLibre', () => ({ useMapLibre: () => maplibre.lib }))

const flyToSpy = maplibre.flyTo

describe('MapsGeneral', () => {
  beforeEach(() => flyToSpy.mockClear())
  afterEach(clearSession)

  it('renders without crashing', async () => {
    const { unmount } = await renderPage(<MapsGeneral />, { route: '/maps/general' })
    expect(screen.getByTestId('maps-general')).toBeInTheDocument()
    // Desmonta DENTRO do teste: o efeito do radar externo resolve num
    // microtask encadeado e, se a limpeza ficar para o afterEach, a
    // atualização cai já durante o teste seguinte — que é onde o React acusa,
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
})
