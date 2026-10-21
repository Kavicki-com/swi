// Fechar a lista da "Buscar operador" sem escolher ninguém: Esc e clique fora.
// Arquivo próprio pelo mesmo motivo do MapsGeneral.operatorSearch.test.tsx (o
// MapsGeneral.test.tsx está no limite de tamanho); os dublês são os dele.
// vitest globals (describe/it/expect/vi) via globals: true.
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
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

const worker = (id: string, name: string, lng: number, lat: number) => ({
  id,
  name,
  lat,
  lng,
  status: 'good',
  avatarUri: '',
  recordedAt: new Date().toISOString(),
})

const onMap = () => maplibre.pins.filter((p) => !p.removed)

async function openMap() {
  const result = await renderPage(<MapsGeneral />, { route: '/maps/general?focus=w1' })
  await waitFor(() => expect(onMap()).toHaveLength(3))
  maplibre.flyTo.mockClear()
  return result
}

const search = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText('Buscar operador'), { target: { value } })

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
  live.value = [
    worker('w1', 'Ana Souza', -46.63, -23.55),
    worker('w2', 'Gabriel Fernandes', -46.64, -23.56),
    worker('w3', 'Gabriela Lima', -46.65, -23.57),
  ]
})

afterEach(clearSession)

describe('MapsGeneral: fechar a lista da busca', () => {
  it('Esc fecha a lista e mantém o filtro dos pinos', async () => {
    const { unmount } = await openMap()
    search('gab')
    expect(await screen.findByRole('button', { name: 'Gabriela Lima' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Gabriela Lima' })).toBeNull())
    expect(onMap()).toHaveLength(2)
    await close(unmount)
  })

  it('clique fora fecha a lista', async () => {
    const { unmount } = await openMap()
    search('gab')
    expect(await screen.findByRole('button', { name: 'Gabriela Lima' })).toBeTruthy()
    fireEvent.pointerDown(document.body)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Gabriela Lima' })).toBeNull())
    await close(unmount)
  })

  it('digitar de novo reabre a lista', async () => {
    const { unmount } = await openMap()
    search('gab')
    await screen.findByRole('button', { name: 'Gabriela Lima' })
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Gabriela Lima' })).toBeNull())
    search('gabr')
    expect(await screen.findByRole('button', { name: 'Gabriela Lima' })).toBeTruthy()
    await close(unmount)
  })

  it('clicar num nome da lista continua escolhendo', async () => {
    const { unmount } = await openMap()
    search('gab')
    const row = await screen.findByRole('button', { name: 'Gabriela Lima' })
    fireEvent.pointerDown(row)
    fireEvent.click(row)
    await waitFor(() => expect(onMap()).toHaveLength(1))
    await close(unmount)
  })
})
