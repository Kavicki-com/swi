// Desenho custom da área de evacuação no maplibre (sem dep nova). Uma camada de
// preenchimento translúcido, uma de contorno e um marcador por vértice. Serve
// os dois momentos: o traçado em edição (vértices arrastáveis) e o polígono
// salvo durante a evacuação ativa (só leitura). O contorno vermelho vem do tema
// (content.error); o magenta dos vértices não tem token semântico (a paleta é
// vermelho/azul/verde/laranja), então mora aqui como constante de mapa, no
// mesmo espírito do HEATMAP_COLOR_RAMP.
import type * as maplibregl from 'maplibre-gl'
import type { AreaVertex } from '@/lib/evacuationArea'

export const AREA_VERTEX_COLOR = '#C026D3'

const SOURCE_ID = 'evac-area'
const FILL_ID = 'evac-area-fill'
const LINE_ID = 'evac-area-line'

export interface AreaColors {
  line: string
  fill: string
  vertex: string
}

export interface DrawAreaOptions {
  colors: AreaColors
  draggable?: boolean
  onVertexDrag?: (index: number, vertex: AreaVertex) => void
}

// Polígono quando já há 3 vértices (anel fechado); traçado parcial como linha
// até lá, para os primeiros cliques já aparecerem ligados.
function areaFeature(ring: AreaVertex[]): GeoJSON.Feature {
  const first = ring[0]
  if (ring.length >= 3 && first) {
    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [[...ring, first]] },
    }
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: ring },
  }
}

function clearLayers(map: maplibregl.Map): void {
  if (map.getLayer(FILL_ID)) map.removeLayer(FILL_ID)
  if (map.getLayer(LINE_ID)) map.removeLayer(LINE_ID)
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
}

/**
 * (Re)desenha a área e devolve um disposer. Chamar de novo a cada mudança do
 * anel: recria source, camadas e marcadores, como o efeito do heatmap.
 */
export function drawAreaLayer(
  map: maplibregl.Map,
  lib: typeof maplibregl,
  ring: AreaVertex[],
  opts: DrawAreaOptions,
): () => void {
  clearLayers(map)
  map.addSource(SOURCE_ID, { type: 'geojson', data: areaFeature(ring) })
  map.addLayer({
    id: FILL_ID,
    type: 'fill',
    source: SOURCE_ID,
    paint: { 'fill-color': opts.colors.fill, 'fill-opacity': 0.2 },
    // 'fill' só pinta geometria de polígono; na linha parcial fica inócua.
    filter: ['==', ['geometry-type'], 'Polygon'],
  })
  map.addLayer({
    id: LINE_ID,
    type: 'line',
    source: SOURCE_ID,
    paint: { 'line-color': opts.colors.line, 'line-width': 3 },
    layout: { 'line-join': 'round', 'line-cap': 'round' },
  })

  const markers = ring.map((vertex, index) => {
    const el = document.createElement('div')
    Object.assign(el.style, {
      width: '14px',
      height: '14px',
      borderRadius: '50%',
      backgroundColor: opts.colors.vertex,
      border: '2px solid #ffffff',
      boxSizing: 'border-box',
      cursor: opts.draggable ? 'grab' : 'default',
    })
    const marker = new lib.Marker({ element: el, draggable: !!opts.draggable })
      .setLngLat(vertex)
      .addTo(map)
    if (opts.draggable && opts.onVertexDrag) {
      marker.on('dragend', () => {
        const { lng, lat } = marker.getLngLat()
        opts.onVertexDrag?.(index, [lng, lat])
      })
    }
    return marker
  })

  return () => {
    markers.forEach((m) => m.remove())
    clearLayers(map)
  }
}
