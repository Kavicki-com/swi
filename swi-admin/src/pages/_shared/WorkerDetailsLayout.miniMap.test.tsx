// Ciclo de vida do minimapa do detalhe de funcionário/admin. Arquivo próprio
// porque aqui o maplibre é um dublê que conta os mapas criados; o
// WorkerDetailsLayout.test.tsx usa o dublê global, que não conta nada.
// vitest globals (describe/it/expect/vi) via globals: true.
import { StrictMode, useEffect, useState } from 'react'
import { act, screen } from '@testing-library/react'
import { renderPage } from '@/test-utils/renderPage'
import { vitalsViewFrom } from '@/services/vitals/vitalsView'
import { WorkerDetailsLayout, type WorkerDetailsData } from './WorkerDetailsLayout'

type FakeMap = { remove: ReturnType<typeof vi.fn>; setCenter: ReturnType<typeof vi.fn> }
type FakeMarker = { element: HTMLElement; setLngLat: ReturnType<typeof vi.fn> }

const maplibre = vi.hoisted(() => {
  const maps: FakeMap[] = []
  const markers: FakeMarker[] = []
  const lib = {
    Map: vi.fn((_opts: { center: [number, number] }) => {
      const map = { remove: vi.fn(), setCenter: vi.fn() }
      maps.push(map)
      return map
    }),
    Marker: vi.fn((opts: { element: HTMLElement }) => {
      const marker = {
        element: opts.element,
        setLngLat: vi.fn(() => marker),
        addTo: () => marker,
      }
      markers.push(marker)
      return marker
    }),
  }
  // false imita a primeira visita da sessão, com o maplibre ainda carregando.
  return { lib, maps, markers, ready: true }
})
vi.mock('@/lib/useMapLibre', () => ({
  useMapLibre: () => (maplibre.ready ? maplibre.lib : null),
}))
// Mapas e pinos na ordem em que foram criados.
const mapAt = (i: number) => maplibre.maps[i]!
const markerAt = (i: number) => maplibre.markers[i]!

const BASE: WorkerDetailsData = {
  name: 'Fulano de Teste',
  age: 43,
  bloodType: 'B+',
  role: 'Operador',
  specialization: 'Setor Leste',
  avatarUri: 'https://fotos.test/fulano.png',
  vitals: vitalsViewFrom(null),
}
const AQUI = { lat: -23.55, lng: -46.63 }
const ALI = { lat: -23.56, lng: -46.64 }

type PageState = {
  position: { lat: number; lng: number } | null
  avatarUri: string
  // Só força uma nova renderização, como a releitura da telemetria faz.
  tick: number
}
const page = { set: (_next: Partial<PageState>) => {} }

// Monta `worker` na hora, a cada renderização, como EmployeeDetails e
// AdminDetails fazem.
function Page({ initial }: { initial: Partial<PageState> }) {
  const [state, setState] = useState<PageState>({
    position: AQUI,
    avatarUri: BASE.avatarUri,
    tick: 0,
    ...initial,
  })
  useEffect(() => {
    page.set = (next) => setState((cur) => ({ ...cur, ...next }))
  }, [])
  return (
    <WorkerDetailsLayout
      worker={{ ...BASE, avatarUri: state.avatarUri }}
      position={state.position}
      testID="worker-details"
      onBack={() => {}}
      backA11yLabel="Voltar"
      onOpenFullMap={() => {}}
      topRightAction={null}
    />
  )
}

const open = (initial: Partial<PageState> = {}) =>
  renderPage(<Page initial={initial} />, { route: '/employees/w1', path: '/employees/:id' })

const change = (next: Partial<PageState>) =>
  act(async () => {
    page.set(next)
  })

const pinPhoto = () => (markerAt(0).element.firstElementChild as HTMLElement).style

beforeEach(() => {
  maplibre.ready = true
  maplibre.maps.length = 0
  maplibre.markers.length = 0
  maplibre.lib.Map.mockClear()
  maplibre.lib.Marker.mockClear()
})

describe('minimapa do detalhe', () => {
  it('renderizar de novo a página não recria o mapa', async () => {
    await open()
    expect(maplibre.lib.Map).toHaveBeenCalledTimes(1)

    await change({ tick: 1 })
    await change({ tick: 2 })
    await change({ tick: 3 })

    expect(maplibre.lib.Map).toHaveBeenCalledTimes(1)
    expect(mapAt(0).remove).not.toHaveBeenCalled()
  })

  it('posição nova move o pino e recentraliza, sem recriar o mapa', async () => {
    await open()

    await change({ position: ALI })

    expect(maplibre.lib.Map).toHaveBeenCalledTimes(1)
    expect(maplibre.lib.Marker).toHaveBeenCalledTimes(1)
    expect(markerAt(0).setLngLat).toHaveBeenLastCalledWith([ALI.lng, ALI.lat])
    expect(mapAt(0).setCenter).toHaveBeenLastCalledWith([ALI.lng, ALI.lat])
  })

  it('posição que some e volta não recria o mapa', async () => {
    await open()

    await change({ position: null })
    expect(screen.getByText('Sem posição ao vivo')).toBeTruthy()
    await change({ position: ALI })

    expect(screen.queryByText('Sem posição ao vivo')).toBeNull()
    expect(maplibre.lib.Map).toHaveBeenCalledTimes(1)
    expect(mapAt(0).remove).not.toHaveBeenCalled()
    expect(markerAt(0).setLngLat).toHaveBeenLastCalledWith([ALI.lng, ALI.lat])
    expect(mapAt(0).setCenter).toHaveBeenLastCalledWith([ALI.lng, ALI.lat])
  })

  it('sem posição na chegada, o mapa nasce com a primeira posição', async () => {
    await open({ position: null })
    expect(maplibre.lib.Map).not.toHaveBeenCalled()

    await change({ position: AQUI })

    expect(maplibre.lib.Map).toHaveBeenCalledTimes(1)
    expect(maplibre.lib.Map.mock.calls[0]![0]).toMatchObject({ center: [AQUI.lng, AQUI.lat] })
  })

  it('maplibre que chega depois da posição cria o mapa nela', async () => {
    maplibre.ready = false
    await open()
    expect(maplibre.lib.Map).not.toHaveBeenCalled()

    maplibre.ready = true
    await change({ tick: 1 })

    expect(maplibre.lib.Map).toHaveBeenCalledTimes(1)
    expect(maplibre.lib.Map.mock.calls[0]![0]).toMatchObject({ center: [AQUI.lng, AQUI.lat] })
  })

  it('a foto do pino só muda quando muda a foto da pessoa', async () => {
    await open()
    expect(pinPhoto().backgroundImage).toContain('fulano.png')

    await change({ avatarUri: 'https://fotos.test/nova.png' })

    expect(pinPhoto().backgroundImage).toContain('nova.png')
    expect(maplibre.lib.Map).toHaveBeenCalledTimes(1)
  })

  it('sair da página remove o mapa uma vez', async () => {
    const { unmount } = await open()

    await act(async () => {
      unmount()
    })

    expect(mapAt(0).remove).toHaveBeenCalledTimes(1)
  })

  // O app roda em StrictMode: o React monta, desmonta e remonta os efeitos. O
  // mapa da primeira montagem sai, e o pino segue no que ficou.
  it('no StrictMode, a posição nova chega ao mapa que ficou', async () => {
    await renderPage(
      <StrictMode>
        <Page initial={{}} />
      </StrictMode>,
      { route: '/employees/w1', path: '/employees/:id' },
    )
    // Montagem dupla: o primeiro mapa saiu, o segundo é o que fica.
    expect(maplibre.lib.Map).toHaveBeenCalledTimes(2)
    expect(mapAt(0).remove).toHaveBeenCalledTimes(1)

    await change({ position: ALI })

    expect(mapAt(1).remove).not.toHaveBeenCalled()
    expect(markerAt(1).setLngLat).toHaveBeenLastCalledWith([ALI.lng, ALI.lat])
    expect(mapAt(1).setCenter).toHaveBeenLastCalledWith([ALI.lng, ALI.lat])
  })
})
