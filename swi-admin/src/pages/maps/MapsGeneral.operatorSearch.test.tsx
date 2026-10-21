// "Buscar operador" do mapa geral. Arquivo próprio porque o MapsGeneral.test.tsx
// está no limite de tamanho; os dublês são o mínimo para a tela montar com a
// camada de operadores ligada (`?focus`).
// vitest globals (describe/it/expect/vi) via globals: true.
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { MapsGeneral } from './MapsGeneral'
import { clearSession, renderPage } from '@/test-utils/renderPage'

// Posições ao vivo de mentira: `emit` avisa quem lê que a lista mudou, como o
// socket faria a cada snapshot.
const live = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  return {
    value: null as Array<Record<string, unknown>> | null,
    subscribe: (cb: () => void) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    emit: () => listeners.forEach((cb) => cb()),
  }
})
vi.mock('@/hooks/useLivePositions', async () => {
  const { useSyncExternalStore } = await import('react')
  return { useLivePositions: () => useSyncExternalStore(live.subscribe, () => live.value) }
})
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

describe('MapsGeneral: buscar operador', () => {
  it('deixa no mapa só quem casa com o nome, sem diferenciar acento nem maiúscula', async () => {
    const { unmount } = await openMap()
    search('GABRIEL')
    await waitFor(() => expect(onMap()).toHaveLength(2))
    search('souza')
    await waitFor(() => expect(onMap()).toHaveLength(1))
    await close(unmount)
  })

  it('com um único resultado, voa até o operador', async () => {
    const { unmount } = await openMap()
    search('ana')
    await waitFor(() =>
      expect(maplibre.flyTo).toHaveBeenCalledWith(
        expect.objectContaining({ center: [-46.63, -23.55], zoom: 16 }),
      ),
    )
    await close(unmount)
  })

  it('com mais de um resultado, não move a câmera', async () => {
    const { unmount } = await openMap()
    search('gabriel')
    await waitFor(() => expect(onMap()).toHaveLength(2))
    expect(maplibre.flyTo).not.toHaveBeenCalled()
    await close(unmount)
  })

  it('apagar a busca devolve todos os operadores', async () => {
    const { unmount } = await openMap()
    search('ana')
    await waitFor(() => expect(onMap()).toHaveLength(1))
    search('')
    await waitFor(() => expect(onMap()).toHaveLength(3))
    await close(unmount)
  })

  it('mostra a lista dos operadores que casam com o texto', async () => {
    const { unmount } = await openMap()
    search('gab')
    expect(await screen.findByRole('button', { name: 'Gabriel Fernandes' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Gabriela Lima' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Ana Souza' })).toBeNull()
    await close(unmount)
  })

  it('escolher um nome da lista deixa só ele no mapa e voa até ele', async () => {
    const { unmount } = await openMap()
    search('gab')
    fireEvent.click(await screen.findByRole('button', { name: 'Gabriela Lima' }))
    await waitFor(() => expect(onMap()).toHaveLength(1))
    await waitFor(() =>
      expect(maplibre.flyTo).toHaveBeenCalledWith(
        expect.objectContaining({ center: [-46.65, -23.57], zoom: 16 }),
      ),
    )
    // Escolhido: a lista fecha.
    expect(screen.queryByRole('button', { name: 'Gabriel Fernandes' })).toBeNull()
    await close(unmount)
  })

  it('escolher um nome contido em outro seleciona só a pessoa escolhida', async () => {
    live.value = [
      worker('w1', 'João Pereira', -46.61, -23.51),
      worker('w2', 'João Pereira Filho', -46.62, -23.52),
      worker('w3', 'Ana Souza', -46.63, -23.53),
    ]
    const { unmount } = await openMap()
    search('joão pereira')
    await waitFor(() => expect(onMap()).toHaveLength(2))
    fireEvent.click(await screen.findByRole('button', { name: 'João Pereira' }))
    await waitFor(() => expect(onMap()).toHaveLength(1))
    await waitFor(() =>
      expect(maplibre.flyTo).toHaveBeenCalledWith(
        expect.objectContaining({ center: [-46.61, -23.51], zoom: 16 }),
      ),
    )
    // Escolhido: a lista fecha, mesmo com o nome do outro casando com o texto.
    expect(screen.queryByRole('button', { name: 'João Pereira Filho' })).toBeNull()
    await close(unmount)
  })

  it('com o escolhido fora do ao vivo, não cai no outro nome que casa com o texto', async () => {
    const joao = worker('w1', 'João Pereira', -46.61, -23.51)
    const others = [
      worker('w2', 'João Pereira Filho', -46.62, -23.52),
      worker('w3', 'Ana Souza', -46.63, -23.53),
    ]
    live.value = [joao, ...others]
    const { unmount } = await openMap()
    search('joão pereira')
    fireEvent.click(await screen.findByRole('button', { name: 'João Pereira' }))
    await waitFor(() => expect(onMap()).toHaveLength(1))
    maplibre.flyTo.mockClear()
    await act(async () => {
      live.value = others
      live.emit()
    })
    await waitFor(() => expect(onMap()).toHaveLength(0))
    expect(maplibre.flyTo).not.toHaveBeenCalled()
    // Voltou a mandar posição: o pino dele reaparece.
    await act(async () => {
      live.value = [joao, ...others]
      live.emit()
    })
    await waitFor(() => expect(onMap()).toHaveLength(1))
    await close(unmount)
  })

  it('digitar depois de escolher desfaz a escolha', async () => {
    live.value = [
      worker('w1', 'João Pereira', -46.61, -23.51),
      worker('w2', 'João Pereira Filho', -46.62, -23.52),
      worker('w3', 'Ana Souza', -46.63, -23.53),
    ]
    const { unmount } = await openMap()
    search('joão pereira')
    fireEvent.click(await screen.findByRole('button', { name: 'João Pereira' }))
    await waitFor(() => expect(onMap()).toHaveLength(1))
    search('joão')
    await waitFor(() => expect(onMap()).toHaveLength(2))
    expect(await screen.findByRole('button', { name: 'João Pereira Filho' })).toBeTruthy()
    await close(unmount)
  })

  it('sem resultado mostra "Nenhum resultado"', async () => {
    const { unmount } = await openMap()
    search('zzz')
    expect(await screen.findByText('Nenhum resultado')).toBeTruthy()
    await close(unmount)
  })
})
