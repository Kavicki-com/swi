// vitest globals (describe/it/expect/vi) via globals: true.
import type * as maplibregl from 'maplibre-gl'
import { buildPin } from './pinBuilders'
import type { DashboardMapMarker } from '@/services/dashboard'

// O tamanho do pino é prop do LocationPin do DS; o espião guarda o que chega.
const pinProps = vi.hoisted(() => [] as Array<{ size?: number }>)
vi.mock('@kavicki/swi-design-system', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kavicki/swi-design-system')>()
  return {
    ...actual,
    LocationPin: (props: { size?: number }) => {
      pinProps.push(props)
      return null
    },
  }
})

// Só o que o buildPin usa do maplibre: um Marker que aceita o elemento.
const lib = {
  Marker: vi.fn(() => {
    const marker = { setLngLat: () => marker, addTo: () => marker }
    return marker
  }),
} as unknown as typeof maplibregl
const map = {} as maplibregl.Map

const W1: DashboardMapMarker = {
  id: 'w1',
  name: 'Ana Souza',
  lat: -23.55,
  lng: -46.63,
  status: 'good',
  avatarUri: '',
}

describe('buildPin', () => {
  it('o pino do funcionário leva o texto de passar o mouse que recebe', () => {
    const pin = buildPin(W1, map, lib, vi.fn(), 'Ana Souza, última posição às 14:32')
    expect(pin.el.title).toBe('Ana Souza, última posição às 14:32')
    pin.root.unmount()
  })

  it('sem texto, o pino fica sem título', () => {
    const pin = buildPin(W1, map, lib, vi.fn())
    expect(pin.el.hasAttribute('title')).toBe(false)
    pin.root.unmount()
  })

  // Quem chega pelo "Mapa completo" de uma pessoa precisa achá-la entre os
  // outros pinos: o dela é maior e fica por cima.
  it('o pino em foco fica maior e por cima dos outros', async () => {
    pinProps.length = 0
    const normal = buildPin(W1, map, lib, vi.fn())
    const focused = buildPin(W1, map, lib, vi.fn(), undefined, { focused: true })
    // O pino monta num root React próprio, fora da árvore; espera ele pintar.
    await new Promise((r) => setTimeout(r, 0))

    expect(focused.el.style.zIndex).toBe('1')
    expect(normal.el.style.zIndex).toBe('')
    const [normalProps, focusedProps] = pinProps
    expect(normalProps?.size).toBeUndefined()
    expect(focusedProps?.size).toBeGreaterThan(40)
    normal.root.unmount()
    focused.root.unmount()
  })
})
