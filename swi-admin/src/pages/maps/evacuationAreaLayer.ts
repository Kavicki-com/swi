// Desenho custom da área de evacuação no maplibre (sem dep nova). Uma camada de
// preenchimento translúcido, uma de contorno e um marcador por vértice. Serve
// três momentos: o trajeto aberto em vetorização (linha, com o primeiro ponto
// como fecho), o trajeto fechado em edição (vértices arrastáveis) e o polígono
// salvo durante a evacuação ativa (só leitura). O contorno vermelho vem do tema
// (content.error); o magenta dos vértices não tem token semântico (a paleta é
// vermelho/azul/verde/laranja), então mora aqui como constante de mapa, no
// mesmo espírito do HEATMAP_COLOR_RAMP.
import type * as maplibregl from 'maplibre-gl'
import { MIN_AREA_VERTICES } from '@/lib/areaDraft'
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
  // Trajeto fechado vira polígono preenchido; aberto, só a linha. Sem dizer,
  // fechado: é o caso da área salva da evacuação ativa.
  closed?: boolean
  draggable?: boolean
  onVertexDrag?: (index: number, vertex: AreaVertex) => void
  // Com o trajeto aberto e três pontos ou mais, o primeiro vértice fica
  // destacado e o clique nele fecha a área.
  onFirstVertexClick?: () => void
}

// Polígono só com o trajeto fechado (anel com o primeiro ponto repetido);
// aberto, linha ligando os pontos na ordem dos cliques.
function areaFeature(ring: AreaVertex[], closed: boolean): GeoJSON.Feature {
  const first = ring[0]
  if (closed && ring.length >= MIN_AREA_VERTICES && first) {
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
  const closed = opts.closed ?? true
  const offerClose = !closed && ring.length >= MIN_AREA_VERTICES && !!opts.onFirstVertexClick
  clearLayers(map)
  map.addSource(SOURCE_ID, { type: 'geojson', data: areaFeature(ring, closed) })
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
    // O maplibre escuta o clique no contêiner do mapa, que também abriga os
    // marcadores: sem parar a propagação, clicar num vértice existente viraria
    // um ponto novo no trajeto.
    el.addEventListener('click', (ev) => ev.stopPropagation())
    const marker = new lib.Marker({ element: el, draggable: !!opts.draggable })
      .setLngLat(vertex)
      .addTo(map)
    // O primeiro ponto é o fecho do trajeto: maior, borda grossa, e o clique
    // nele fecha a área. O soltar de um arraste também dispara clique, então o
    // clique logo depois de arrastar só encerra o arraste e não fecha. Como é
    // botão, também fecha pelo teclado (Enter ou Espaço).
    if (index === 0 && offerClose) {
      Object.assign(el.style, {
        width: '20px',
        height: '20px',
        borderWidth: '4px',
        cursor: 'pointer',
      })
      el.setAttribute('role', 'button')
      el.setAttribute('aria-label', 'Fechar área')
      el.title = 'Clique para fechar a área'
      el.tabIndex = 0
      let dragged = false
      marker.on('dragstart', () => {
        dragged = true
      })
      // O clique do soltar chega antes deste timer; se o arraste terminou
      // fora do vértice e não houve clique, a trava não engole o próximo.
      marker.on('dragend', () => {
        setTimeout(() => {
          dragged = false
        }, 0)
      })
      el.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' && ev.key !== ' ') return
        ev.preventDefault()
        opts.onFirstVertexClick?.()
      })
      el.addEventListener('click', () => {
        if (dragged) {
          dragged = false
          return
        }
        opts.onFirstVertexClick?.()
      })
    }
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
