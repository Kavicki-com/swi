// src/pages/alerts/AlertsList.tsx
// /alerts. Lives inside AppLayout. Real-tile maplibre map
// with three overlay modes:
//   1. SearchInput "Pesquisar" + 4 filter chips (status filter).
//   2. Maplibre map (ESRI World Imagery satellite tiles) covering the
//      remaining area. Worker pins are real maplibre Markers anchored at
//      each lat/lng, so they pan/zoom with the basemap.
//   3. mapMode toggles in top-left:
//        'heat'  → adds a maplibre heatmap layer (trilha real de posições,
//                  agregada em células pelo backend).
//        'meteo' → adds a RainViewer raster overlay (real-time precipitation
//                  radar; no API key, free).
//      'pins' is the default with no extra overlay.
//
// Why maplibre + real tiles: the demo screen previously rendered three
// static PNG basemaps and projected pins via percent-of-bbox. Real tiles
// + maplibre Markers make the map respond to pan/zoom and let pins stay
// glued to their geographic coordinates regardless of mode.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import { useNavigate, useParams } from 'react-router-dom'
import type * as maplibregl from 'maplibre-gl'
import { useMapLibre } from '@/lib/useMapLibre'
import { SATELLITE_STYLE } from '@/lib/mapStyles'
import { heatPointsFromCells, buildHeatmapGeoJSON, HEATMAP_COLOR_RAMP } from '@/lib/heatmap'
import { positionHeatApi } from '@/services/api/positionHeat'
import { DEMO_DATA_LABEL } from '@/services/vitals/vitalsView'
import { createPinElement, type PinElement } from '@/lib/pinFactory'
import { MapAttribution } from '@/components/MapAttribution'
import { DataOriginBadge } from '@/components/DataOriginBadge'
import { getRainViewerLatestRadar } from '@/lib/rainViewer'
import {
  Button,
  Chip,
  Icon,
  LocationPin,
  SearchInput,
  Text,
  Toast,
  useTheme,
} from '@kavicki/swi-design-system'
import { type DashboardMapMarker } from '@/services/dashboard'
import { useLiveMapMarkers } from '@/hooks/useLiveMapMarkers'
import { useEvacuation } from '@/hooks/useEvacuation'
import { useWeatherAlert } from '@/hooks/useWeatherAlert'
import { countWorkersInArea, type AreaVertex } from '@/lib/evacuationArea'
import {
  addVertex,
  closeDraft,
  EMPTY_DRAFT,
  isReady,
  moveVertex,
  undoDraft,
  type AreaDraft,
} from '@/lib/areaDraft'
import { drawAreaLayer, AREA_VERTEX_COLOR } from '@/pages/maps/evacuationAreaLayer'
import { buildMusterPin } from '@/pages/maps/musterPointPin'
import { EvacuationDrawToolbar } from './components/EvacuationDrawToolbar'
import { SelectedWorkerCard } from './components/SelectedWorkerCard'
import { ConfirmDialog } from '@/pages/_shared/ConfirmDialog'

// Sem posição nenhuma o mapa nasce no mesmo ponto padrão do mapa geral.
const DEFAULT_CENTER: [number, number] = [-46.63, -23.55]

const FILTER_CHIPS = [
  { value: 'all', label: 'Todos' },
  { value: 'good', label: 'Sem incidentes' },
  { value: 'alert', label: 'Risco de incidente' },
  { value: 'low', label: 'Urgência médica' },
] as const

function passesFilter(status: DashboardMapMarker['status'], filter: string): boolean {
  if (filter === 'all') return true
  if (filter === 'good') return status === 'good'
  if (filter === 'alert') return status === 'alert'
  // Sem leitura do aparelho não é urgência médica: o pino neutro só aparece em
  // "Todos", senão quem nunca pareou um aparelho cairia no filtro de urgência.
  if (filter === 'low') return status === 'low'
  return true
}

type PinHandle = PinElement & { marker: maplibregl.Marker }

// Pino de quem pediu ajuda: o badge urgente do desenho, maior que os 40 px
// padrão do LocationPin, e por cima dos vizinhos.
const HELP_PIN_SIZE = 52

function buildMarker(
  m: DashboardMapMarker,
  map: maplibregl.Map,
  lib: typeof maplibregl,
  help: boolean,
  onClick: () => void,
): PinHandle {
  const { el, root } = createPinElement({
    onClick,
    content: (
      <LocationPin
        variant="badge"
        status={m.status}
        name={m.name}
        size={help ? HELP_PIN_SIZE : undefined}
      />
    ),
  })
  if (help) el.style.zIndex = '1'
  const marker = new lib.Marker({ element: el, anchor: 'bottom' })
    .setLngLat([m.lng, m.lat])
    .addTo(map)
  return { marker, root, el }
}

export function AlertsList() {
  const theme = useTheme()
  const navigate = useNavigate()
  const { employeeId } = useParams<{ employeeId?: string }>()
  // Posições REAIS ao vivo (REST snapshot + WS) com a cor do estado real de
  // cada funcionário. null (carregando) → [].
  const { markers: liveMarkers, entryFor } = useLiveMapMarkers()
  const markers = useMemo<DashboardMapMarker[]>(() => liveMarkers ?? [], [liveMarkers])
  // Alerta meteorológico real do local da empresa (GET /weather), relido a
  // cada 5 minutos. null = sem alerta vigente: a tela fica sem a faixa.
  const { alert: weatherAlert, demo: weatherDemo } = useWeatherAlert()
  // Leitura de demonstração em algum pino, ou alerta de clima de demonstração:
  // o selo avisa o operador.
  const hasDemo = useMemo(
    () => weatherDemo || markers.some((m) => entryFor(m.id)?.telemetry.origin === 'DEMO'),
    [weatherDemo, markers, entryFor],
  )
  // Evacuação real: dispatch/encerramento + progresso X/N ao vivo.
  const {
    evacuation,
    error: evacError,
    start: startEvacuation,
    end: endEvacuation,
  } = useEvacuation()
  const ackedIds = useMemo(
    () => new Set((evacuation?.workers ?? []).filter((w) => w.acked).map((w) => w.id)),
    [evacuation],
  )
  // Encerrar a evacuação pede confirmação: o fim vale para a obra inteira.
  const [confirmingEnd, setConfirmingEnd] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<string>('all')
  const [mapMode, setMapMode] = useState<'pins' | 'heat' | 'meteo'>('pins')
  // Fluxo de demarcação em dois passos: "Iniciar evacuação" abre o passo da
  // área (MEL-13, vetorizada ponto a ponto; só vale depois que o gestor fecha
  // o trajeto clicando no primeiro ponto) e, com a área fechada, o passo do
  // ponto de encontro (um clique, obrigatório). Confirmar dispara com os dois.
  const [drawStep, setDrawStep] = useState<'area' | 'muster' | null>(null)
  const [draft, setDraft] = useState<AreaDraft>(EMPTY_DRAFT)
  const [draftMuster, setDraftMuster] = useState<AreaVertex | null>(null)
  // Polígono salvo da evacuação ativa (anel fechado [lng, lat]), ou null.
  const savedArea = evacuation?.area ?? null
  // Ponto de encontro salvo; evacuações anteriores ao ponto obrigatório não têm.
  const savedMuster = evacuation?.musterPoint ?? null
  // Quantos funcionários estão dentro da área salva, sobre as posições ao vivo.
  const workersInArea = useMemo(() => countWorkersInArea(markers, savedArea), [markers, savedArea])
  // Contorno vermelho do tema; magenta dos vértices como no print (sem token).
  const areaColors = useMemo(
    () => ({ line: theme.content.error, fill: theme.content.error, vertex: AREA_VERTEX_COLOR }),
    [theme],
  )
  const beginDraw = () => {
    setDraft(EMPTY_DRAFT)
    setDraftMuster(null)
    setDrawStep('area')
  }
  const cancelDraw = () => {
    setDrawStep(null)
    setDraft(EMPTY_DRAFT)
    setDraftMuster(null)
  }
  const confirmDraw = () => {
    const muster = draftMuster
    // Os botões já travam sem área fechada e sem ponto; a guarda é a rede de
    // segurança do contrato (o backend recusa 400 sem o ponto).
    if (!muster || !isReady(draft)) return
    const area = draft.vertices
    setDrawStep(null)
    setDraft(EMPTY_DRAFT)
    setDraftMuster(null)
    void startEvacuation(area, muster)
  }
  // O handler de clique do mapa é instalado uma vez; este ref deixa ele ver o
  // estado atual sem reinstalar e recriar o mapa.
  const mapClickRef = useRef<(v: AreaVertex) => void>(() => {})
  mapClickRef.current = (v: AreaVertex) => {
    if (drawStep === 'area') {
      setDraft((d) => addVertex(d, v))
      return
    }
    if (drawStep === 'muster') {
      setDraftMuster(v)
      return
    }
    navigate('/alerts')
  }

  const lib = useMapLibre()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [mapReady, setMapReady] = useState(false)
  // Selected marker overlay screen position (left/top in container px).
  // Updated via map.project() on every map move/zoom so the EmployeeOverviewCard
  // stays glued to its pin while the user pans the map.
  const [overlayPos, setOverlayPos] = useState<{ left: number; top: number } | null>(null)
  // Stable ref to navigate so the marker effect doesn't tear down on each
  // navigation (markers re-render is expensive — destroys + rebuilds React
  // subtrees inside maplibre Markers).
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  const employeeIdRef = useRef(employeeId)
  employeeIdRef.current = employeeId

  // Quem tem pedido de ajuda aberto ou atendido: o pino sai como alerta
  // urgente, destacado, até o pedido fechar. O pedido não é medição, então
  // não muda o estado de saúde; só o pino desta tela.
  const helpIds = useMemo(
    () => new Set(markers.filter((m) => entryFor(m.id)?.helpRequest).map((m) => m.id)),
    [markers, entryFor],
  )

  const filteredMarkers = useMemo(
    () =>
      markers.filter((m) => {
        if (!passesFilter(helpIds.has(m.id) ? 'low' : m.status, filter)) return false
        if (search.trim() && !m.name.toLowerCase().includes(search.toLowerCase())) return false
        return true
      }),
    [markers, search, filter, helpIds],
  )

  const selectedMarker = useMemo(
    () => (employeeId ? (markers.find((m) => m.id === employeeId) ?? null) : null),
    [employeeId, markers],
  )

  // O mapa nasce UMA vez, no primeiro snapshot (mesmo vazio: sem posição ele
  // centra no ponto padrão e a evacuação continua podendo ser desenhada).
  // Depender de `markers` direto destruiria/recriaria o mapa a cada heartbeat
  // WS (3s). Tear down on unmount.
  const markersLoaded = liveMarkers !== null
  const noPositions = liveMarkers !== null && liveMarkers.length === 0
  const initialMarkersRef = useRef<DashboardMapMarker[] | null>(null)
  if (initialMarkersRef.current === null && liveMarkers !== null) {
    initialMarkersRef.current = liveMarkers
  }

  useEffect(() => {
    if (!lib || !containerRef.current || !markersLoaded) return
    const initial = initialMarkersRef.current ?? []
    const center: [number, number] =
      initial.length > 0
        ? [
            initial.reduce((s, m) => s + m.lng, 0) / initial.length,
            initial.reduce((s, m) => s + m.lat, 0) / initial.length,
          ]
        : DEFAULT_CENTER
    const map = new lib.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center,
      zoom: 14,
      attributionControl: false,
    })
    mapRef.current = map
    map.on('load', () => {
      if (initial.length >= 2) {
        const bounds = new lib.LngLatBounds()
        initial.forEach((m) => bounds.extend([m.lng, m.lat]))
        map.fitBounds(bounds, { padding: 80, animate: false, maxZoom: 16 })
      }
      setMapReady(true)
    })
    // No passo da área, o clique no mapa põe um vértice; no passo do ponto,
    // troca o ponto de encontro; fora do desenho, o clique no mapa vazio fecha
    // o card (o pino é um elemento DOM por cima do canvas, então o clique nele
    // não chega aqui; só o clique fora dele).
    map.on('click', (e: maplibregl.MapMouseEvent) => {
      mapClickRef.current([e.lngLat.lng, e.lngLat.lat])
    })
    return () => {
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [lib, markersLoaded])

  // Durante evacuação ativa, a borda do pino mostra o estado do ACK (verde =
  // confirmou no ponto de encontro, laranja = a caminho), estado real do
  // fluxo, não vitais. Sem evacuação, mantém o status de saúde de sempre. O
  // pedido de ajuda vale acima dos dois e vai por último, para ficar por cima.
  const displayMarkers = useMemo<DashboardMapMarker[]>(() => {
    const colored = evacuation
      ? filteredMarkers.map((m) => ({
          ...m,
          status: (ackedIds.has(m.id) ? 'good' : 'alert') as DashboardMapMarker['status'],
        }))
      : filteredMarkers
    const help = colored
      .filter((m) => helpIds.has(m.id))
      .map((m) => ({ ...m, status: 'low' as const }))
    return [...colored.filter((m) => !helpIds.has(m.id)), ...help]
  }, [filteredMarkers, evacuation, ackedIds, helpIds])

  // Render worker pins as maplibre Markers. Re-render when the filtered
  // list changes. Click toggles selection via URL.
  useEffect(() => {
    const map = mapRef.current
    if (!lib || !map || !mapReady) return
    const handles = displayMarkers.map((m) =>
      buildMarker(m, map, lib, helpIds.has(m.id), () => {
        const cur = employeeIdRef.current
        navigateRef.current(cur === m.id ? '/alerts' : `/alerts/${m.id}`)
      }),
    )
    return () => {
      handles.forEach((h) => {
        h.marker.remove()
      })
      // Defer the React subtree unmount to a microtask — calling
      // root.unmount() synchronously inside a useEffect cleanup that fires
      // during a state-driven re-render logs the "Attempted to synchronously
      // unmount a root while React was already rendering" warning and in
      // rare cases leaves the route in a blank state. Microtask defers
      // it past the current render cycle (same fix as AlertsRescueRoute).
      queueMicrotask(() => {
        handles.forEach((h) => {
          h.root.unmount()
          h.el.remove()
        })
      })
    }
  }, [lib, mapReady, displayMarkers, helpIds])

  // Heatmap layer, só no modo 'heat': a trilha real de posições das últimas 24
  // horas, agregada em células pelo backend. Sem trilha, nenhuma camada.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || mapMode !== 'heat') return
    let cancelled = false
    void positionHeatApi.heat().then(({ data }) => {
      if (cancelled || mapRef.current !== map) return
      const points = heatPointsFromCells(data?.cells ?? [])
      if (points.length === 0) return
      const geojson = buildHeatmapGeoJSON(points)
      if (map.getLayer('heatmap-layer')) map.removeLayer('heatmap-layer')
      if (map.getSource('heatmap-points')) map.removeSource('heatmap-points')
      map.addSource('heatmap-points', { type: 'geojson', data: geojson })
      map.addLayer({
        id: 'heatmap-layer',
        type: 'heatmap',
        source: 'heatmap-points',
        paint: {
          'heatmap-weight': ['get', 'weight'],
          'heatmap-intensity': 2.0,
          'heatmap-radius': 70,
          'heatmap-opacity': 0.82,
          'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], ...HEATMAP_COLOR_RAMP],
        },
      })
    })
    return () => {
      cancelled = true
      // Cleanups rodam na ordem de declaração: ao sair da tela o `map.remove()`
      // do efeito de init já destruiu o style, e chamar getLayer() sobre ele
      // lançaria, derrubando a árvore. A guarda abaixo só mexe nas camadas
      // quando o mapa deste efeito ainda é o mapa vigente.
      if (mapRef.current !== map) return
      if (map.getLayer('heatmap-layer')) map.removeLayer('heatmap-layer')
      if (map.getSource('heatmap-points')) map.removeSource('heatmap-points')
    }
  }, [mapReady, mapMode])

  // Meteo layer — RainViewer real-time precipitation radar. Free, no key.
  // We hit their public manifest for the latest timestamp and use it as a
  // raster source. Re-fetched only when meteo mode toggles on.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || mapMode !== 'meteo') return
    let cancelled = false
    getRainViewerLatestRadar().then((result) => {
      if (cancelled || !result) return
      const { host, path } = result
      if (map.getLayer('meteo-layer')) map.removeLayer('meteo-layer')
      if (map.getSource('meteo')) map.removeSource('meteo')
      map.addSource('meteo', {
        type: 'raster',
        tiles: [`${host}${path}/256/{z}/{x}/{y}/2/1_1.png`],
        tileSize: 256,
        // RainViewer's actual max zoom is 7 (despite docs claiming 12). From z=8+
        // the server returns a 1.4KB "Zoom Level Not Supported" PNG instead of
        // real radar data, so cap here and let maplibre overzoom (stretch) the
        // z=7 tiles for higher map zooms.
        maxzoom: 7,
      })
      map.addLayer({
        id: 'meteo-layer',
        type: 'raster',
        source: 'meteo',
        paint: { 'raster-opacity': 0.75 },
      })
    })
    return () => {
      cancelled = true
      // `cancelled` só protege o .then do radar; não impede este cleanup de
      // rodar depois do map.remove(). Ver a guarda gêmea no cleanup do heatmap.
      if (mapRef.current !== map) return
      if (map.getLayer('meteo-layer')) map.removeLayer('meteo-layer')
      if (map.getSource('meteo')) map.removeSource('meteo')
    }
  }, [mapReady, mapMode])

  // Traçado em edição: redesenha a cada vértice adicionado ou arrastado. No
  // passo da área os vértices são arrastáveis (soltar um atualiza o anel) e,
  // com o trajeto aberto, o clique no primeiro ponto fecha a área; no passo do
  // ponto a área do rascunho fica só leitura, como referência.
  useEffect(() => {
    const map = mapRef.current
    if (!lib || !map || !mapReady || !drawStep) return
    const dispose = drawAreaLayer(map, lib, draft.vertices, {
      colors: areaColors,
      closed: draft.closed,
      draggable: drawStep === 'area',
      onVertexDrag: (index, vertex) => setDraft((d) => moveVertex(d, index, vertex)),
      onFirstVertexClick: drawStep === 'area' ? () => setDraft(closeDraft) : undefined,
    })
    return dispose
  }, [lib, mapReady, drawStep, draft, areaColors])

  // Área salva da evacuação ativa: polígono vermelho com vértices magenta, só
  // leitura. Enquanto o admin redesenha, o traçado acima tem a vez.
  useEffect(() => {
    const map = mapRef.current
    if (!lib || !map || !mapReady || drawStep || !savedArea) return
    const dispose = drawAreaLayer(map, lib, savedArea, { colors: areaColors })
    return dispose
  }, [lib, mapReady, drawStep, savedArea, areaColors])

  // Pino do ponto de encontro: o do rascunho enquanto o gestor marca, o salvo
  // da evacuação ativa quando o desenho está fechado. As deps são as
  // coordenadas, não o par: cada ACK do socket devolve um dto novo, e depender
  // da identidade do array remontaria o pino a cada confirmação.
  const musterPin = drawStep === 'muster' ? draftMuster : drawStep ? null : savedMuster
  const musterLng = musterPin?.[0] ?? null
  const musterLat = musterPin?.[1] ?? null
  useEffect(() => {
    const map = mapRef.current
    if (!lib || !map || !mapReady || musterLng == null || musterLat == null) return
    return buildMusterPin([musterLng, musterLat], map, lib)
  }, [lib, mapReady, musterLng, musterLat])

  // Selected marker → screen position tracker. Runs whenever the selected
  // marker changes and re-runs on every map move/zoom so the overlay card
  // stays glued to its pin.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !selectedMarker) {
      setOverlayPos(null)
      return
    }
    const update = () => {
      const p = map.project([selectedMarker.lng, selectedMarker.lat])
      setOverlayPos({ left: p.x, top: p.y })
    }
    update()
    map.on('move', update)
    map.on('zoom', update)
    return () => {
      map.off('move', update)
      map.off('zoom', update)
    }
  }, [mapReady, selectedMarker])

  return (
    <View testID="alerts-list" style={{ gap: theme.gap.m, flex: 1 }}>
      <SearchInput
        value={search}
        onChangeText={setSearch}
        placeholder="Pesquisar"
        onClear={() => setSearch('')}
      />

      <View
        style={{
          flexDirection: 'row',
          gap: theme.gap.s,
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View
          style={{ flexDirection: 'row', gap: theme.gap.s, flexWrap: 'wrap', alignItems: 'center' }}
        >
          {FILTER_CHIPS.map((c) => (
            <Chip
              key={c.value}
              label={c.label}
              variant={filter === c.value ? 'filled' : 'outline'}
              onPress={() => setFilter(c.value)}
            />
          ))}
          {/* Posição e cor do pino são reais. Só leitura de demonstração
              leva selo. */}
          {hasDemo ? <DataOriginBadge label={DEMO_DATA_LABEL} testID="alerts-demo-badge" /> : null}
        </View>

        {/* Evacuação e, logo abaixo e na mesma largura, o atalho de Resgates. */}
        <View style={{ gap: theme.gap.s, alignItems: 'flex-end' }}>
          {/* Evacuação real: sem ativa → desenhar a área e disparar; ativa →
            progresso X/N ao vivo (WS evacuation-ack) + encerramento. */}
          {drawStep ? (
            <EvacuationDrawToolbar
              step={drawStep}
              vertexCount={draft.vertices.length}
              closed={draft.closed}
              hasMuster={draftMuster !== null}
              onUndo={() => setDraft(undoDraft)}
              onCancel={cancelDraw}
              onNext={() => {
                if (isReady(draft)) setDrawStep('muster')
              }}
              onBack={() => setDrawStep('area')}
              onConfirm={confirmDraw}
            />
          ) : evacuation ? (
            <View
              testID="evacuation-banner"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.gap.m,
                paddingHorizontal: theme.padding.s,
                paddingVertical: theme.padding.xs,
                borderRadius: theme.border.radius.m,
                backgroundColor: theme.surface.errorLight,
              }}
            >
              <Icon name="notifications" size={18} color={theme.content.light} />
              <Text
                variant="body.s"
                color={theme.content.light}
                style={{ fontWeight: '700' as const }}
              >
                Evacuação em andamento: {evacuation.acked}/{evacuation.total} confirmados
              </Text>
              {savedArea ? (
                <Text
                  testID="evacuation-in-area"
                  variant="body.s"
                  color={theme.content.light}
                  style={{ fontWeight: '700' as const }}
                >
                  {workersInArea} dentro da área
                </Text>
              ) : null}
              <Button
                label="Encerrar evacuação"
                backgroundColor={theme.surface.error}
                onPress={() => setConfirmingEnd(true)}
              />
            </View>
          ) : (
            <Button
              label="Iniciar evacuação"
              backgroundColor={theme.surface.error}
              onPress={beginDraw}
            />
          )}
          {/* Mesma largura do botão de evacuação (fullWidth na coluna), texto ao centro. */}
          <Button
            label="Resgates"
            fullWidth
            backgroundColor={theme.surface.secondary}
            onPress={() => navigate('/alerts/rescues')}
          />
        </View>
      </View>

      {evacError ? (
        <Text variant="body.s" color={theme.content.error}>
          {evacError}
        </Text>
      ) : null}

      <View
        style={{
          flex: 1,
          minHeight: 480,
          borderRadius: theme.border.radius.m,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Maplibre map container — fills the parent View. */}
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

        {/* Mandatory ESRI attribution (bottom-right, non-interactive). */}
        <MapAttribution />

        {/* Sem posição de ninguém: o mapa fica (a evacuação se desenha nele) e
            o aviso diz por que não há pino. Só informa: o clique atravessa. */}
        {noPositions ? (
          <View
            style={{
              pointerEvents: 'none',
              position: 'absolute',
              top: theme.padding.m,
              left: 0,
              right: 0,
              alignItems: 'center',
              zIndex: 2,
            }}
          >
            <View
              style={{
                backgroundColor: theme.surface.medium,
                borderRadius: theme.border.radius.m,
                paddingHorizontal: theme.padding.s,
                paddingVertical: theme.padding.xs,
              }}
            >
              <Text testID="alerts-no-positions" variant="body.s" color={theme.content.medium}>
                Sem posição ao vivo
              </Text>
            </View>
          </View>
        ) : null}

        {/* Floating mode toggles (top-left over map). */}
        <View
          style={{
            position: 'absolute',
            top: theme.gap.s,
            left: theme.gap.s,
            flexDirection: 'row',
            gap: theme.gap.xs,
            zIndex: 2,
          }}
        >
          {(
            [
              {
                value: 'heat',
                icon: 'mode_heat' as const,
                label: 'Mapa de calor',
                activeBg: theme.surface.warning,
              },
              {
                value: 'meteo',
                icon: 'wb_twilight' as const,
                label: 'Mapa meteorológico',
                activeBg: theme.surface.secondary,
              },
            ] as const
          ).map((opt) => {
            const active = mapMode === opt.value
            return (
              <Pressable
                key={opt.value}
                accessibilityLabel={opt.label}
                onPress={() => setMapMode((mm) => (mm === opt.value ? 'pins' : opt.value))}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: theme.border.radius.s,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: active ? opt.activeBg : theme.background,
                }}
              >
                <Icon name={opt.icon} color={theme.content.dark} size={18} />
              </Pressable>
            )
          })}
        </View>

        {/* Faixa do alerta meteorológico (frame alerts-metereologic-map, camada
            "Toast"). É o Toast do DS como ele é: título e frase vêm prontos do
            backend. O ícone de nuvem e o botão "Evacuar área" do desenho não
            existem no Toast de hoje e dependem de bump do DS; a evacuação
            segue no botão "Iniciar evacuação" acima do mapa. */}
        {weatherAlert ? (
          <View
            style={{
              // A faixa só informa: o clique atravessa para o mapa.
              pointerEvents: 'none',
              position: 'absolute',
              left: theme.padding.m,
              right: theme.padding.m,
              bottom: theme.padding.xl,
              alignItems: 'center',
              zIndex: 2,
            }}
          >
            <View style={{ width: '100%', maxWidth: 494 }}>
              <Toast
                testID="weather-alert"
                variant="error"
                title={`Alerta de ${weatherAlert.event}`}
                message={weatherAlert.description}
              />
            </View>
          </View>
        ) : null}

        {/* Selected marker overlay. Tracked to its pin via
            map.project() so it follows pan/zoom. Os dados saem da leitura
            real do funcionário; sem leitura o cartão do DS mostra a ausência
            e a linha abaixo diz em que pé está a leitura. */}
        {selectedMarker && overlayPos ? (
          <SelectedWorkerCard
            marker={selectedMarker}
            entry={entryFor(selectedMarker.id)}
            position={overlayPos}
            onClose={() => navigate('/alerts')}
            onCreateRescue={() => navigate(`/alerts/${selectedMarker.id}/rescue`)}
          />
        ) : null}
      </View>
      {confirmingEnd ? (
        <ConfirmDialog
          title="Encerrar evacuação?"
          message="A evacuação termina para todos os funcionários da obra."
          confirmLabel="Encerrar"
          confirmDanger
          onConfirm={() => {
            setConfirmingEnd(false)
            void endEvacuation()
          }}
          onCancel={() => setConfirmingEnd(false)}
        />
      ) : null}
    </View>
  )
}
