// Smoke test — verifies the page mounts without throwing under the
// providers it expects at runtime (theme + auth + router). Behavioural
// assertions live in dedicated tests; this guard catches regressions
// from DS bumps, route refactors, and import-graph changes.
// vitest globals (describe/it/expect/afterEach) are available via globals: true
import { fireEvent, screen } from '@testing-library/react'
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
      flyTo: () => {},
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
  return { lib }
})
vi.mock('@/lib/useMapLibre', () => ({ useMapLibre: () => maplibre.lib }))

describe('MapsGeneral', () => {
  afterEach(clearSession)

  it('renders without crashing', () => {
    expect(() => renderPage(<MapsGeneral />, { route: '/maps/general' })).not.toThrow()
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
    const view = renderPage(<MapsGeneral />, { route: '/maps/general' })

    fireEvent.click(screen.getByRole('button', { name: 'Mapa de calor' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Produtividade' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Zonas de alerta' }))

    // Navegar pelo menu lateral desmonta a página. Se algum cleanup tocar o
    // mapa depois do remove(), isto lança e o usuário vê tela preta.
    expect(() => view.unmount()).not.toThrow()
  })
})
