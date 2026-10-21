// Lista da "Buscar câmera" do mapa geral. Arquivo próprio porque o
// MapsGeneral.test.tsx está no limite de tamanho (798 de 800 linhas), como já
// acontece com o MapsGeneral.operatorSearch.test.tsx. Os dublês são o mínimo
// para a tela montar com a camada de câmeras ligada.
// vitest globals (describe/it/expect/vi) via globals: true.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { MapsGeneral } from './MapsGeneral'
import { clearSession, renderPage } from '@/test-utils/renderPage'

// O mapa só é criado quando os marcadores chegam (`markersLoaded`), então as
// posições ao vivo precisam existir. Sem `?focus` na rota a camada de
// operadores nasce desligada, e os únicos pinos no mapa são os das câmeras.
const live = vi.hoisted(() => [
  {
    id: 'w1',
    name: 'Ana Souza',
    lat: -23.55,
    lng: -46.63,
    status: 'good',
    avatarUri: '',
    recordedAt: new Date().toISOString(),
  },
])
vi.mock('@/hooks/useLivePositions', () => ({ useLivePositions: () => live }))
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

const cameras = vi.hoisted(() => [
  { id: 'cam-a', name: 'Portaria', lat: -23.54, lng: -46.63, url: null },
  { id: 'cam-b', name: 'Pátio central', lat: -23.56, lng: -46.62, url: null },
  // Nome que contém o da primeira: escolher "Portaria" não pode deixar as duas.
  { id: 'cam-c', name: 'Portaria 2', lat: -23.58, lng: -46.61, url: null },
])
vi.mock('@/services/api/cameras', () => ({
  camerasApi: { list: async () => cameras },
}))
const toast = vi.hoisted(() => ({ show: vi.fn() }))
vi.mock('@/lib/demoToast', () => ({ useDemoToast: () => toast }))

// maplibre de mentira: o 'load' dispara na hora; cada pino guarda o elemento e
// se já foi removido, para contar os que estão no mapa.
const maplibre = vi.hoisted(() => {
  const pins: Array<{ el: HTMLElement; removed: boolean }> = []
  const flyTo = vi.fn()
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
    flyTo,
    remove: () => {},
  })
  const makeMarker = (opts?: { element?: HTMLElement }) => {
    const rec = opts?.element ? { el: opts.element, removed: false } : null
    if (rec) pins.push(rec)
    const marker = {
      setLngLat: () => marker,
      addTo: () => marker,
      remove: () => {
        if (rec) rec.removed = true
      },
      on: () => marker,
    }
    return marker
  }
  const lib = {
    Map: vi.fn(() => makeMap()),
    Marker: vi.fn((opts?: { element?: HTMLElement }) => makeMarker(opts)),
    LngLatBounds: vi.fn(() => ({ extend: () => {} })),
  }
  return { lib, pins, flyTo }
})
vi.mock('@/lib/useMapLibre', () => ({ useMapLibre: () => maplibre.lib }))

const onMap = () => maplibre.pins.filter((p) => !p.removed)

/** Monta a tela e liga a camada de câmeras, que nasce desligada. */
async function openCameras() {
  const result = await renderPage(<MapsGeneral />, { route: '/maps/general' })
  fireEvent.click(
    within(screen.getByTestId('maps-controls')).getByRole('button', { name: 'Câmeras' }),
  )
  await waitFor(() => expect(onMap()).toHaveLength(cameras.length))
  maplibre.flyTo.mockClear()
  return result
}

const search = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText('Buscar câmera'), { target: { value } })

async function close(unmount: () => void) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
  await act(async () => {
    unmount()
  })
}

beforeEach(() => {
  maplibre.pins.length = 0
  maplibre.flyTo.mockClear()
})

afterEach(clearSession)

describe('MapsGeneral: buscar câmera', () => {
  it('mostra a lista das câmeras que casam com o texto', async () => {
    const { unmount } = await openCameras()
    search('pat')
    expect(await screen.findByRole('button', { name: 'Pátio central' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Portaria' })).toBeNull()
    await close(unmount)
  })

  it('escolher uma câmera da lista deixa só ela no mapa e voa até ela', async () => {
    const { unmount } = await openCameras()
    search('pat')
    fireEvent.click(await screen.findByRole('button', { name: 'Pátio central' }))
    await waitFor(() => expect(onMap()).toHaveLength(1))
    await waitFor(() =>
      expect(maplibre.flyTo).toHaveBeenCalledWith(
        expect.objectContaining({ center: [-46.62, -23.56], zoom: 16 }),
      ),
    )
    await close(unmount)
  })

  it('escolher uma câmera com nome contido em outro deixa só ela no mapa', async () => {
    const { unmount } = await openCameras()
    search('portaria')
    await waitFor(() => expect(onMap()).toHaveLength(2))
    fireEvent.click(await screen.findByRole('button', { name: 'Portaria' }))
    await waitFor(() => expect(onMap()).toHaveLength(1))
    await waitFor(() =>
      expect(maplibre.flyTo).toHaveBeenCalledWith(
        expect.objectContaining({ center: [-46.63, -23.54], zoom: 16 }),
      ),
    )
    expect(screen.queryByRole('button', { name: 'Portaria 2' })).toBeNull()
    await close(unmount)
  })

  it('sem resultado mostra "Nenhum resultado"', async () => {
    const { unmount } = await openCameras()
    search('zzz')
    expect(await screen.findByText('Nenhum resultado')).toBeTruthy()
    await close(unmount)
  })
})
