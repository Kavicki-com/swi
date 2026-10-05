// vitest globals (describe/it/expect/vi) via globals: true.
import type * as maplibregl from 'maplibre-gl'
import { buildPin } from './pinBuilders'
import type { DashboardMapMarker } from '@/services/dashboard'

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
})
