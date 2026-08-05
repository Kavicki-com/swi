// src/pages/maps/hooks/useMapsGeneral.ts
// Estado, mapa e camadas da tela de Mapas. Extraído de MapsGeneral.tsx sem
// mudança de comportamento: a página virou só o layout flutuante.
//
// A ordem de declaração dos efeitos é significativa: o React roda cleanups
// nessa ordem, e é disso que dependem as guardas `mapRef.current !== map`
// nos cleanups de heatmap e meteo (QA Web #8). Não reordene.
import { useEffect, useMemo, useRef, useState } from 'react'
import { PanResponder } from 'react-native'
import { useNavigate, useLocation } from 'react-router-dom'
import type maplibregl from 'maplibre-gl'
import { useMapLibre } from '@/lib/useMapLibre'
import { SATELLITE_STYLE } from '@/lib/mapStyles'
import { buildHeatmapPoints, buildHeatmapGeoJSON, HEATMAP_COLOR_RAMP } from '@/lib/heatmap'
import { getRainViewerLatestRadar } from '@/lib/rainViewer'
import { useDemoToast } from '@/lib/demoToast'
import { formatBadgeCount, withBadges } from '@/app/nav'
import { type DashboardMapMarker } from '@/services/dashboard'
import { useLivePositions } from '@/hooks/useLivePositions'
import { reportsApi } from '@/services/api/reports'
import { CAMERA_LOCATIONS, type CameraLocation } from '@/services/cameras'
import { buildPin, buildCameraPin } from '../pinBuilders'

// Anchor that every mock coordinate (workers + cameras + heatmap) is defined
// around. When the user hits "Minha localização", we re-anchor the whole
// dataset by adding (geoloc - MOCK_ORIGIN) to every coordinate, so the demo
// surrounds them wherever they are instead of staying in São Paulo.
const MOCK_ORIGIN: [number, number] = [-46.63, -23.55]

// The Bela Vista mock spans ~2km of São Paulo, which is realistic for a
// neighborhood but reads as scattered at the building-level zoom we land on
// after geolocation. We compress relative offsets by this factor so the whole
// dataset fits inside ~400m around the user's pin — the scale of a real
// mining/industrial site. Drag the pin to test: workers/cameras stay clustered.
const SHIFT_SCALE = 0.2

export function useMapsGeneral() {
  const navigate = useNavigate()
  const location = useLocation()
  const lib = useMapLibre()
  const { show: showToast } = useDemoToast()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  // Posições REAIS ao vivo (REST snapshot + WS). null = carregando.
  const mapMarkers = useLivePositions()
  // Badge do menu compacto: contagem REAL de relatórios
  // pendentes. Sem pendências, sem badge — era "+9" fixo até o QA de 2026-07-24.
  // Alertas perdeu o badge: não existe entidade de alerta com estado de leitura
  // pra contar (voltar quando existir, via formatBadgeCount).
  const [pendingReports, setPendingReports] = useState(0)
  useEffect(() => {
    let cancelled = false
    reportsApi.list().then(({ data }) => {
      if (!cancelled) setPendingReports((data ?? []).filter((r) => r.status === 'pending').length)
    })
    return () => {
      cancelled = true
    }
  }, [])
  const navItems = useMemo(
    () => withBadges({ '/reports': formatBadgeCount(pendingReports) }),
    [pendingReports],
  )
  const [mapReady, setMapReady] = useState(false)
  // The neutral state hides employee pins (opacity 0).
  // Pins appear when the user expands the "operators" map control.
  // QA Web #3: `?focus=<id>` chega do pin da lista de Funcionarios. Quando ele
  // existe, a camada de operadores JA nasce ligada, senao o usuario cai num
  // mapa vazio e precisa de um clique extra pra ver quem foi pedir pra ver.
  const focusId = new URLSearchParams(location.search).get('focus')
  const [showOperators, setShowOperators] = useState(focusId !== null)
  // Heatmap state:
  // - showHeatmap drives the MapControl expanded panel
  // - heatmapOptions per-checkbox: produtividade = thermal blob overlay
  //   (Sprint A); zonasAlerta = meteorologic alerts mode (Sprint posterior)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [heatmapOptions, setHeatmapOptions] = useState<{
    produtividade: boolean
    zonasAlerta: boolean
  }>({ produtividade: false, zonasAlerta: false })
  // Cameras state. When the user expands the "Câmeras" map
  // control, the camera fleet pins appear over the satellite map (each pin
  // is a green square LocationPin variant='camera').
  const [showCameras, setShowCameras] = useState(false)

  // Voltar-button position via CSS right/bottom anchors.
  // Per user request: anchor to bottom margin of the viewport (small gap).
  // Specs `bottom: 214` relative to a 1052h `map` parent, which
  // at 978h frame renders ~210px from frame bottom — but at our 1080h viewport
  // that proportional gap is visually too high. Use a small literal margin so
  // the button hugs the bottom edge regardless of viewport height.
  const [backBtnAnchor, setBackBtnAnchor] = useState<{ right: number; bottom: number }>({
    right: 20,
    bottom: 30,
  })
  const anchorRef = useRef(backBtnAnchor)
  anchorRef.current = backBtnAnchor
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  const dragStateRef = useRef<{
    startRight: number
    startBottom: number
    moved: boolean
  } | null>(null)

  // User's real geolocation when they've hit the "Minha localização" button.
  // Drives both the flyTo and the dataset re-anchoring below.
  const [geolocOrigin, setGeolocOrigin] = useState<[number, number] | null>(null)
  // Throttle the geolocation button: at most one request per 5s window.
  // navigator.geolocation.getCurrentPosition can take seconds + dispatch
  // multiple permission prompts if mashed; we want the visual feedback +
  // request rate-limited regardless of what the browser does under the hood.
  const [isLocating, setIsLocating] = useState(false)
  const locateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (locateTimeoutRef.current !== null) clearTimeout(locateTimeoutRef.current)
    },
    [],
  )

  const shiftedMarkers = useMemo<DashboardMapMarker[]>(() => {
    const markers = mapMarkers ?? []
    if (!geolocOrigin) return [...markers]
    return markers.map((m) => ({
      ...m,
      lng: geolocOrigin[0] + (m.lng - MOCK_ORIGIN[0]) * SHIFT_SCALE,
      lat: geolocOrigin[1] + (m.lat - MOCK_ORIGIN[1]) * SHIFT_SCALE,
    }))
  }, [mapMarkers, geolocOrigin])

  const shiftedCameras = useMemo<ReadonlyArray<CameraLocation>>(() => {
    if (!geolocOrigin) return CAMERA_LOCATIONS
    return CAMERA_LOCATIONS.map((c) => ({
      ...c,
      lng: geolocOrigin[0] + (c.lng - MOCK_ORIGIN[0]) * SHIFT_SCALE,
      lat: geolocOrigin[1] + (c.lat - MOCK_ORIGIN[1]) * SHIFT_SCALE,
    }))
  }, [geolocOrigin])

  // Conservative over-estimate of button bbox (measured ~285×71 at 1920w, ~204×52 at 1366w).
  // Used only for clamping during drag; CSS handles initial anchored layout.
  const BTN_W = 300
  const BTN_H = 72

  const backBtnPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragStateRef.current = {
          startRight: anchorRef.current.right,
          startBottom: anchorRef.current.bottom,
          moved: false,
        }
      },
      onPanResponderMove: (_e, gesture) => {
        if (!dragStateRef.current) return
        if (Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3) {
          dragStateRef.current.moved = true
        }
        const w = typeof window !== 'undefined' ? window.innerWidth : 1366
        const h = typeof window !== 'undefined' ? window.innerHeight : 966
        // CSS right-anchor inverts X: dragging right (dx>0) decreases right.
        const newRight = Math.max(
          0,
          Math.min(w - BTN_W, dragStateRef.current.startRight - gesture.dx),
        )
        const newBottom = Math.max(
          0,
          Math.min(h - BTN_H, dragStateRef.current.startBottom - gesture.dy),
        )
        setBackBtnAnchor({ right: newRight, bottom: newBottom })
      },
      onPanResponderRelease: () => {
        const moved = dragStateRef.current?.moved
        dragStateRef.current = null
        // Tap (no movement past threshold) — navigate back to dashboard.
        if (!moved) navigateRef.current('/')
      },
      onPanResponderTerminate: () => {
        dragStateRef.current = null
      },
    }),
  ).current

  // Maps is a full-bleed canvas: kill page-level scrollbar reservation while
  // this route is mounted so the fixed root truly spans the full viewport
  // width (otherwise html keeps a ~15px scrollbar gutter visible on the right).
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // O mapa nasce UMA vez, quando o primeiro snapshot chega. Depender de
  // mapMarkers direto destruiria/recriaria o mapa a cada heartbeat WS (3s) —
  // por isso o gate é o booleano "carregou" e o centro sai de um ref.
  const markersLoaded = mapMarkers !== null
  const initialMarkersRef = useRef<DashboardMapMarker[] | null>(null)
  if (initialMarkersRef.current === null && mapMarkers !== null) {
    initialMarkersRef.current = mapMarkers
  }

  useEffect(() => {
    if (!lib || !containerRef.current || !markersLoaded) return

    const markers = initialMarkersRef.current ?? []
    const center: [number, number] =
      markers.length > 0
        ? [
            markers.reduce((s, m) => s + m.lng, 0) / markers.length,
            markers.reduce((s, m) => s + m.lat, 0) / markers.length,
          ]
        : [-46.63, -23.55]

    const map = new lib.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center,
      zoom: 14,
      attributionControl: false,
    })
    mapRef.current = map

    map.on('load', () => {
      if (markers.length >= 2) {
        const bounds = new lib.LngLatBounds()
        markers.forEach((m) => bounds.extend([m.lng, m.lat]))
        map.fitBounds(bounds, { padding: 80, animate: false, maxZoom: 16 })
      }
      setMapReady(true)
    })

    return () => {
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [markersLoaded, lib])

  // QA Web #3: centraliza no funcionario que veio no `?focus`, uma unica vez.
  // O ref e necessario porque `shiftedMarkers` muda a cada atualizacao de
  // posicao ao vivo (WebSocket); sem ele a camera seria reescrita embaixo do
  // operador toda vez que uma posicao chegasse, o que e pior que o bug.
  const focusedRef = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !focusId || focusedRef.current) return
    const target = shiftedMarkers.find((m) => m.id === focusId)
    // Sem `return` marcando focusedRef: o alvo pode simplesmente ainda nao ter
    // chegado no primeiro snapshot, e queremos tentar de novo no proximo.
    if (!target) return
    focusedRef.current = true
    map.flyTo({ center: [target.lng, target.lat], zoom: 16, duration: 1500 })
  }, [mapReady, focusId, shiftedMarkers])

  useEffect(() => {
    const map = mapRef.current
    if (!lib || !map || !mapReady || !showOperators || shiftedMarkers.length === 0) return

    const handles = shiftedMarkers.map((m) =>
      buildPin(m, map, lib, () => navigate(`/employees/${m.id}`)),
    )

    return () => {
      handles.forEach((h) => {
        h.marker.remove()
      })
      // Defer React subtree unmount to a microtask — sync unmount during
      // render triggers a React 18 warning and can leave the route blank.
      queueMicrotask(() => {
        handles.forEach((h) => {
          h.root.unmount()
          h.el.remove()
        })
      })
    }
  }, [mapReady, shiftedMarkers, showOperators, lib, navigate])

  // Camera pins — rendered when the "Câmeras" MapControl is expanded.
  // Mirrors the operator-pin useEffect; uses the same PinHandle/cleanup
  // pattern. CAMERA_LOCATIONS is a module-level constant (no dependency
  // on summary), so the only triggers are mapReady + showCameras.
  useEffect(() => {
    const map = mapRef.current
    if (!lib || !map || !mapReady || !showCameras) return

    const handles = shiftedCameras.map((c) =>
      buildCameraPin(c, map, lib, () =>
        showToast('Câmera selecionada', `Stream ao vivo de ${c.name}`),
      ),
    )

    return () => {
      handles.forEach((h) => {
        h.marker.remove()
      })
      queueMicrotask(() => {
        handles.forEach((h) => {
          h.root.unmount()
          h.el.remove()
        })
      })
    }
  }, [mapReady, showCameras, shiftedCameras, lib, showToast])

  // Maplibre heatmap layer — replaces the previous CSS radial-gradient overlay.
  // Mock ~150 GeoJSON points clustered around the markers' centroid produce an
  // organic blob with real heatmap-density interpolation (cool blue edges → hot
  // red center), matching the specified visualization shape.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !showHeatmap || !heatmapOptions.produtividade) return

    const center: [number, number] =
      shiftedMarkers.length > 0
        ? [
            shiftedMarkers.reduce((s, m) => s + m.lng, 0) / shiftedMarkers.length,
            shiftedMarkers.reduce((s, m) => s + m.lat, 0) / shiftedMarkers.length,
          ]
        : (geolocOrigin ?? MOCK_ORIGIN)

    // Shows ONE dense organic blob spanning ~half the visible map,
    // with a hot magenta/red core fading to orange/yellow/green/cyan at edges.
    // To get that shape with maplibre we need (a) tightly clustered points so
    // their kernels fuse rather than producing many small blobs, (b) enough
    // points + intensity to push the density curve past the red threshold, and
    // (c) a secondary hot core to drive the magenta peak in the center.
    // The spread also scales with SHIFT_SCALE when geolocated so the blob
    // matches the tightened worker cluster.
    const spreadFactor = geolocOrigin ? SHIFT_SCALE : 1
    const corePoints = buildHeatmapPoints(center, 220, 0.006 * spreadFactor)
    const haloPoints = buildHeatmapPoints(center, 280, 0.018 * spreadFactor)
    const geojson = buildHeatmapGeoJSON([...corePoints, ...haloPoints])

    // Defensive: clear any stale layer/source from a prior strict-mode mount.
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

    return () => {
      // Guarda de unmount (QA Web #8, BLOQUEADOR: "a tela fica preta" ao sair
      // da página com o mapa de calor ligado).
      //
      // O React roda cleanups na ORDEM DE DECLARAÇÃO, e o efeito que cria o
      // mapa é declarado ANTES deste. No unmount, `map.remove()` roda primeiro
      // e destrói o style; então este cleanup chamava getLayer() num mapa morto
      // e lançava. Exceção em cleanup derruba a árvore inteira, e era isso que
      // o usuário via como tela preta.
      //
      // `mapRef.current` já foi zerado pelo cleanup do mapa, então a comparação
      // distingue os dois casos: re-run normal (mesma instância, limpa) e
      // unmount (instância morta, não toca). Sem API privada da lib.
      if (mapRef.current !== map) return
      if (map.getLayer('heatmap-layer')) map.removeLayer('heatmap-layer')
      if (map.getSource('heatmap-points')) map.removeSource('heatmap-points')
    }
  }, [mapReady, shiftedMarkers, geolocOrigin, showHeatmap, heatmapOptions.produtividade])

  // "Você está aqui" dot — drawn at the coordinates returned by the browser's
  // geolocation API (initial guess), then user-draggable to correct the API's
  // imprecision (desktop browsers without GPS typically resolve to IP-based
  // coords that can be km off). On dragend we update geolocOrigin, which
  // cascades through coordShift → shiftedMarkers/shiftedCameras → heatmap,
  // re-anchoring the whole mock dataset around the corrected position.
  // Colors hard-coded for contrast over the always-dark satellite tiles.
  useEffect(() => {
    const map = mapRef.current
    if (!lib || !map || !mapReady || !geolocOrigin) return

    const el = document.createElement('div')
    el.style.cssText =
      'width:16px;height:16px;border-radius:999px;background-color:#3b82f6;' +
      'border:3px solid #ffffff;box-shadow:0 0 8px rgba(0,0,0,0.55);' +
      'cursor:grab;'
    const marker = new lib.Marker({ element: el, draggable: true })
      .setLngLat(geolocOrigin)
      .addTo(map)
    marker.on('dragstart', () => {
      el.style.cursor = 'grabbing'
    })
    marker.on('dragend', () => {
      el.style.cursor = 'grab'
      const { lng, lat } = marker.getLngLat()
      setGeolocOrigin([lng, lat])
    })
    return () => {
      marker.remove()
    }
  }, [lib, mapReady, geolocOrigin])

  // Meteorologic overlay (Zonas de alerta) — RainViewer real-time radar
  // raster, same approach used on /alerts meteo mode. Replaces the previous
  // mock green ellipses placeholder. Free, no API key.
  // - Use the manifest's `path` hash (not `time` number) — timestamp URLs
  //   expire ~24h.
  // - Cap source maxzoom at 7 — RainViewer docs claim z=12 but real tiles
  //   stop at z=7; beyond that the server returns a "Zoom Level Not
  //   Supported" placeholder PNG.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !showHeatmap || !heatmapOptions.zonasAlerta) return
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
      // Mesma guarda do cleanup do heatmap, e pelo mesmo motivo: "Zonas de
      // alerta" era o SEGUNDO filtro que o QA ligava antes da tela preta
      // (Web #8). `cancelled` só protege o .then; não protege este cleanup de
      // rodar depois do map.remove().
      if (mapRef.current !== map) return
      if (map.getLayer('meteo-layer')) map.removeLayer('meteo-layer')
      if (map.getSource('meteo')) map.removeSource('meteo')
    }
  }, [mapReady, showHeatmap, heatmapOptions.zonasAlerta])

  // Corpo verbatim do onPress do botão "Minha localização", que morava no
  // JSX da página. Pede a posição ao browser, voa até ela e re-ancora o
  // dataset de demo em volta do usuário.
  const handleLocate = () => {
    if (isLocating) return
    if (!navigator.geolocation) {
      showToast('Geolocalização indisponível', 'Browser não suporta navigator.geolocation')
      return
    }
    setIsLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const map = mapRef.current
        if (map) {
          const next: [number, number] = [pos.coords.longitude, pos.coords.latitude]
          setGeolocOrigin(next)
          // zoom 16 ≈ ~500m viewport — buildings visible, mock cluster fits,
          // and ESRI World Imagery has z16 tiles globally (z17+ is patchy).
          map.flyTo({
            center: next,
            zoom: 16,
            duration: 1500,
          })
          showToast(
            'Localização encontrada',
            'Arraste o pin azul se a posição estiver imprecisa — dados de demo seguem.',
          )
        }
        locateTimeoutRef.current = setTimeout(() => {
          setIsLocating(false)
          locateTimeoutRef.current = null
        }, 5000)
      },
      (err) => {
        showToast('Não foi possível localizar', err.message || 'Permissão negada')
        setIsLocating(false)
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  return {
    containerRef,
    navItems,
    showOperators,
    setShowOperators,
    showHeatmap,
    setShowHeatmap,
    heatmapOptions,
    setHeatmapOptions,
    showCameras,
    setShowCameras,
    isLocating,
    handleLocate,
    backBtnPanResponder,
    backBtnAnchor,
  }
}
