// Camada da área de evacuação: trajeto aberto vira linha, fechado vira
// polígono, e o primeiro ponto fecha o trajeto quando a tela pede.
import type * as maplibregl from 'maplibre-gl'
import { drawAreaLayer } from './evacuationAreaLayer'
import type { AreaVertex } from '@/lib/evacuationArea'

function fakes() {
  const sources: Record<string, { data: GeoJSON.Feature }> = {}
  const layers = new Set<string>()
  const elements: HTMLElement[] = []
  const markers: Marker[] = []
  const map = {
    getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
    getSource: (id: string) => sources[id],
    addSource: (id: string, spec: { data: GeoJSON.Feature }) => {
      sources[id] = spec
    },
    addLayer: ({ id }: { id: string }) => layers.add(id),
    removeLayer: (id: string) => layers.delete(id),
    removeSource: (id: string) => {
      delete sources[id]
    },
  }
  class Marker {
    handlers: Record<string, (() => void)[]> = {}
    constructor(opts: { element: HTMLElement }) {
      elements.push(opts.element)
      markers.push(this)
    }
    setLngLat() {
      return this
    }
    addTo() {
      return this
    }
    on(event: string, cb: () => void) {
      ;(this.handlers[event] ??= []).push(cb)
      return this
    }
    fire(event: string) {
      this.handlers[event]?.forEach((cb) => cb())
    }
    getLngLat() {
      return { lng: 0, lat: 0 }
    }
    remove() {}
  }
  return {
    map: map as unknown as maplibregl.Map,
    lib: { Marker } as unknown as typeof maplibregl,
    geometry: () => sources['evac-area']?.data.geometry,
    elements,
    markers,
  }
}

const colors = { line: 'red', fill: 'red', vertex: 'magenta' }
const RING: AreaVertex[] = [
  [-46.64, -23.53],
  [-46.6, -23.52],
  [-46.58, -23.55],
]

describe('drawAreaLayer', () => {
  it('trajeto aberto é linha, mesmo com três pontos', () => {
    const f = fakes()
    drawAreaLayer(f.map, f.lib, RING, { colors, closed: false })
    expect(f.geometry()?.type).toBe('LineString')
  })

  it('trajeto fechado é polígono com o primeiro ponto repetido no fim', () => {
    const f = fakes()
    drawAreaLayer(f.map, f.lib, RING, { colors, closed: true })
    expect(f.geometry()).toEqual({ type: 'Polygon', coordinates: [[...RING, RING[0]]] })
  })

  it('sem dizer, a área é fechada (a área salva da evacuação ativa)', () => {
    const f = fakes()
    drawAreaLayer(f.map, f.lib, RING, { colors })
    expect(f.geometry()?.type).toBe('Polygon')
  })

  it('aberto com três pontos, o primeiro vértice fecha o trajeto', () => {
    const f = fakes()
    const onFirstVertexClick = vi.fn()
    drawAreaLayer(f.map, f.lib, RING, { colors, closed: false, onFirstVertexClick })
    const first = f.elements[0]
    expect(first?.getAttribute('aria-label')).toBe('Fechar área')
    expect(first?.getAttribute('role')).toBe('button')
    expect(first?.title).toBe('Clique para fechar a área')
    expect(first?.style.width).toBe('20px')
    first?.click()
    expect(onFirstVertexClick).toHaveBeenCalledTimes(1)
    expect(f.elements[1]?.getAttribute('aria-label')).toBeNull()
  })

  it('com menos de três pontos, o primeiro vértice não fecha', () => {
    const f = fakes()
    const onFirstVertexClick = vi.fn()
    drawAreaLayer(f.map, f.lib, RING.slice(0, 2), { colors, closed: false, onFirstVertexClick })
    expect(f.elements[0]?.getAttribute('aria-label')).toBeNull()
    f.elements[0]?.click()
    expect(onFirstVertexClick).not.toHaveBeenCalled()
  })

  it('já fechado, o primeiro vértice não oferece fechar de novo', () => {
    const f = fakes()
    const onFirstVertexClick = vi.fn()
    drawAreaLayer(f.map, f.lib, RING, { colors, closed: true, onFirstVertexClick })
    expect(f.elements[0]?.getAttribute('aria-label')).toBeNull()
  })

  it('clique em qualquer vértice não chega ao mapa', () => {
    const f = fakes()
    drawAreaLayer(f.map, f.lib, RING, { colors, closed: false, onFirstVertexClick: vi.fn() })
    // O contêiner faz o papel do mapa: o clique que borbulha até ele vira ponto novo.
    const container = document.createElement('div')
    f.elements.forEach((el) => container.appendChild(el))
    const mapClick = vi.fn()
    container.addEventListener('click', mapClick)
    f.elements[1]?.click()
    f.elements[0]?.click()
    expect(mapClick).not.toHaveBeenCalled()
  })

  it('arrastar o primeiro vértice não fecha a área', () => {
    const f = fakes()
    const onFirstVertexClick = vi.fn()
    drawAreaLayer(f.map, f.lib, RING, {
      colors,
      closed: false,
      draggable: true,
      onFirstVertexClick,
    })
    f.markers[0]?.fire('dragstart')
    f.elements[0]?.click()
    expect(onFirstVertexClick).not.toHaveBeenCalled()
    f.elements[0]?.click()
    expect(onFirstVertexClick).toHaveBeenCalledTimes(1)
  })

  it('arraste que termina fora do vértice não engole o próximo clique', () => {
    vi.useFakeTimers()
    try {
      const f = fakes()
      const onFirstVertexClick = vi.fn()
      drawAreaLayer(f.map, f.lib, RING, {
        colors,
        closed: false,
        draggable: true,
        onFirstVertexClick,
      })
      f.markers[0]?.fire('dragstart')
      f.markers[0]?.fire('dragend')
      vi.runAllTimers()
      f.elements[0]?.click()
      expect(onFirstVertexClick).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('o primeiro vértice fecha pelo teclado', () => {
    const f = fakes()
    const onFirstVertexClick = vi.fn()
    drawAreaLayer(f.map, f.lib, RING, { colors, closed: false, onFirstVertexClick })
    const first = f.elements[0]
    expect(first?.tabIndex).toBe(0)
    const ev = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    first?.dispatchEvent(ev)
    expect(onFirstVertexClick).toHaveBeenCalledTimes(1)
    expect(ev.defaultPrevented).toBe(true)
  })
})
