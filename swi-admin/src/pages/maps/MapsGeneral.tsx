// src/pages/maps/MapsGeneral.tsx
// Maps · General view — full-bleed satellite map with floating overlays:
// compact left side-menu, three right-side MapControls (operators/heatmap/cameras),
// and a "Voltar ao dashboard" CTA. Layout matches Figma frame 32:2488.
import { useEffect, useRef, useState } from 'react'
import { PanResponder, View } from 'react-native'
import { createRoot, type Root } from 'react-dom/client'
import { useNavigate, useLocation } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  Button,
  HeaderUserInfo,
  Icon,
  LocationPin,
  Logo,
  MapControl,
  SideMenu,
  SwiThemeProvider,
  useTheme,
  type IconName,
} from '@kavicki/swi-design-system'
import { useAuth } from '@/hooks/useAuth'
import {
  dashboardApi,
  type DashboardMapMarker,
  type DashboardSummary,
} from '@/services/mockApi/dashboard'
import workerA from '@/assets/avatars/worker-a.png'

// Compact navigation list — Figma 32:2488 map-side-menu shows 7 icon-only items.
// Reports + Alerts carry "+9" unread badges per Figma node 165:21150 / 165:21152.
type NavItem = {
  value: string
  label: string
  icon: IconName
  badge?: string
}

const NAV: NavItem[] = [
  { value: '/', label: 'Home', icon: 'home_filled' },
  { value: '/admins', label: 'Administradores', icon: 'admin_filled' },
  { value: '/employees', label: 'Funcionários', icon: 'worker_filled' },
  { value: '/monitoring/alerts', label: 'Monitoramento', icon: 'monitor_filled' },
  { value: '/reports', label: 'Relatórios', icon: 'reports_filled', badge: '+9' },
  { value: '/alerts', label: 'Alertas', icon: 'bell_filled', badge: '+9' },
  { value: '/user/settings', label: 'Configurações', icon: 'settings_filled' },
]

// ESRI World Imagery — same tile source the Dashboard MapBanner uses.
const ESRI_SATELLITE_STYLE = {
  version: 8 as const,
  sources: {
    'esri-imagery': {
      type: 'raster' as const,
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution:
        'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      minzoom: 0,
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: 'esri-imagery',
      type: 'raster' as const,
      source: 'esri-imagery',
    },
  ],
}

// Heatmap "Produtividade" mock points — Gaussian-ish cluster around `center`.
// Used to feed the maplibre `heatmap-points` source; replaces the earlier CSS
// radial-gradient overlay (which produced an unnaturally smooth ellipse).
// In production this is replaced by real aggregated event coordinates from
// the worker telemetry API.
function buildHeatmapPoints(
  center: [number, number],
  count: number,
  spread: number,
): Array<{ lng: number; lat: number; weight: number }> {
  const pts: Array<{ lng: number; lat: number; weight: number }> = []
  for (let i = 0; i < count; i++) {
    // Box-Muller transform for normally-distributed offsets — produces an
    // organic cluster denser near `center`, fading out at the edges.
    const u = 1 - Math.random()
    const v = Math.random()
    const r = Math.sqrt(-2 * Math.log(u)) * spread
    const theta = 2 * Math.PI * v
    const dx = r * Math.cos(theta)
    const dy = r * Math.sin(theta)
    const distance = Math.sqrt(dx * dx + dy * dy)
    const weight = Math.max(0.2, 1 - distance / (spread * 2.4))
    pts.push({ lng: center[0] + dx, lat: center[1] + dy, weight })
  }
  return pts
}

// Bridge: render <LocationPin/> into a detached div so it can be passed to
// maplibregl.Marker (only accepts HTMLElement). SwiThemeProvider is needed
// because the detached React tree doesn't inherit the app-level theme context.
type PinHandle = { marker: maplibregl.Marker; root: Root; el: HTMLDivElement }

function buildPin(m: DashboardMapMarker, map: maplibregl.Map): PinHandle {
  const el = document.createElement('div')
  el.style.cursor = 'pointer'
  const root = createRoot(el)
  root.render(
    <SwiThemeProvider>
      <LocationPin avatarUri={m.avatarUri} status={m.status} name={m.name} />
    </SwiThemeProvider>,
  )
  const marker = new maplibregl.Marker({ element: el }).setLngLat([m.lng, m.lat]).addTo(map)
  return { marker, root, el }
}

// Mock camera fleet — coords scattered around the São Paulo Bela Vista region
// where the operator mock data lives. Used to render camera pins on the map
// when the "Câmeras" MapControl is expanded (Figma 33:4421).
type CameraLocation = { id: string; lng: number; lat: number; name: string }

const CAMERA_LOCATIONS: ReadonlyArray<CameraLocation> = [
  { id: 'cam-01', lng: -46.638, lat: -23.541, name: 'Câmera Norte 1' },
  { id: 'cam-02', lng: -46.625, lat: -23.544, name: 'Câmera Norte 2' },
  { id: 'cam-03', lng: -46.642, lat: -23.547, name: 'Câmera Centro Oeste' },
  { id: 'cam-04', lng: -46.628, lat: -23.548, name: 'Câmera Central' },
  { id: 'cam-05', lng: -46.615, lat: -23.549, name: 'Câmera Leste 1' },
  { id: 'cam-06', lng: -46.635, lat: -23.552, name: 'Câmera Sul Oeste' },
  { id: 'cam-07', lng: -46.622, lat: -23.554, name: 'Câmera Sul Central' },
  { id: 'cam-08', lng: -46.61, lat: -23.553, name: 'Câmera Sul Leste' },
  { id: 'cam-09', lng: -46.64, lat: -23.558, name: 'Câmera Periferia SW' },
  { id: 'cam-10', lng: -46.626, lat: -23.56, name: 'Câmera Sul 2' },
  { id: 'cam-11', lng: -46.615, lat: -23.562, name: 'Câmera Sul Leste 2' },
  { id: 'cam-12', lng: -46.63, lat: -23.564, name: 'Câmera Sul Periferia' },
]

function buildCameraPin(c: CameraLocation, map: maplibregl.Map): PinHandle {
  const el = document.createElement('div')
  el.style.cursor = 'pointer'
  const root = createRoot(el)
  root.render(
    <SwiThemeProvider>
      <LocationPin variant="camera" name={c.name} />
    </SwiThemeProvider>,
  )
  const marker = new maplibregl.Marker({ element: el }).setLngLat([c.lng, c.lat]).addTo(map)
  return { marker, root, el }
}

export function MapsGeneral() {
  const { user } = useAuth()
  const theme = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [mapReady, setMapReady] = useState(false)
  // Figma neutral state hides employee pins (node 33:3917 opacity:0).
  // Pins appear when the user expands the "operators" map control.
  const [showOperators, setShowOperators] = useState(false)
  // Heatmap state — Figma 33:3924 + Screenshot_41:
  // - showHeatmap drives the MapControl expanded panel
  // - heatmapOptions per-checkbox: produtividade = thermal blob overlay
  //   (Sprint A); zonasAlerta = meteorologic alerts mode (Sprint posterior)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [heatmapOptions, setHeatmapOptions] = useState<{
    produtividade: boolean
    zonasAlerta: boolean
  }>({ produtividade: false, zonasAlerta: false })
  // Cameras state — Figma 33:4421. When the user expands the "Câmeras" map
  // control, the camera fleet pins appear over the satellite map (each pin
  // is a green square LocationPin variant='camera').
  const [showCameras, setShowCameras] = useState(false)

  // Voltar-button position via CSS right/bottom anchors.
  // Per user request: anchor to bottom margin of the viewport (small gap).
  // Figma 32:2502 specs `bottom: 214` relative to a 1052h `map` parent, which
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

  useEffect(() => {
    let cancelled = false
    dashboardApi.summary({ orgId: 'org_seed_1' }).then(({ data }) => {
      if (!cancelled && data) setSummary(data)
    })
    return () => {
      cancelled = true
    }
  }, [])

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

  useEffect(() => {
    if (!containerRef.current || !summary) return

    const markers = summary.mapMarkers
    const center: [number, number] =
      markers.length > 0
        ? [
            markers.reduce((s, m) => s + m.lng, 0) / markers.length,
            markers.reduce((s, m) => s + m.lat, 0) / markers.length,
          ]
        : [-46.63, -23.55]

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: ESRI_SATELLITE_STYLE,
      center,
      zoom: 14,
      attributionControl: false,
    })
    mapRef.current = map

    map.on('load', () => {
      if (markers.length >= 2) {
        const bounds = new maplibregl.LngLatBounds()
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
  }, [summary])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !summary || !showOperators) return

    const handles = summary.mapMarkers.map((m) => buildPin(m, map))

    return () => {
      handles.forEach((h) => {
        h.marker.remove()
        h.root.unmount()
        h.el.remove()
      })
    }
  }, [mapReady, summary, showOperators])

  // Camera pins — rendered when the "Câmeras" MapControl is expanded.
  // Mirrors the operator-pin useEffect; uses the same PinHandle/cleanup
  // pattern. CAMERA_LOCATIONS is a module-level constant (no dependency
  // on summary), so the only triggers are mapReady + showCameras.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !showCameras) return

    const handles = CAMERA_LOCATIONS.map((c) => buildCameraPin(c, map))

    return () => {
      handles.forEach((h) => {
        h.marker.remove()
        h.root.unmount()
        h.el.remove()
      })
    }
  }, [mapReady, showCameras])

  // Maplibre heatmap layer — replaces the previous CSS radial-gradient overlay.
  // Mock ~150 GeoJSON points clustered around the markers' centroid produce an
  // organic blob with real heatmap-density interpolation (cool blue edges → hot
  // red center), matching Figma 33:3924 visualization shape.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !summary || !showHeatmap || !heatmapOptions.produtividade) return

    const markers = summary.mapMarkers
    const center: [number, number] =
      markers.length > 0
        ? [
            markers.reduce((s, m) => s + m.lng, 0) / markers.length,
            markers.reduce((s, m) => s + m.lat, 0) / markers.length,
          ]
        : [-46.63, -23.55]

    // Figma 33:3924 shows ONE dense organic blob spanning ~half the visible map,
    // with a hot magenta/red core fading to orange/yellow/green/cyan at edges.
    // To get that shape with maplibre we need (a) tightly clustered points so
    // their kernels fuse rather than producing many small blobs, (b) enough
    // points + intensity to push the density curve past the red threshold, and
    // (c) a secondary hot core to drive the magenta peak in the center.
    const corePoints = buildHeatmapPoints(center, 220, 0.006)
    const haloPoints = buildHeatmapPoints(center, 280, 0.018)
    const points = [...corePoints, ...haloPoints]
    const geojson: GeoJSON.FeatureCollection<GeoJSON.Point> = {
      type: 'FeatureCollection',
      features: points.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: { weight: p.weight },
      })),
    }

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
        'heatmap-color': [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0,
          'rgba(34,211,238,0)',
          0.08,
          'rgb(34,211,238)',
          0.24,
          'rgb(34,197,94)',
          0.44,
          'rgb(250,204,21)',
          0.64,
          'rgb(249,115,22)',
          0.84,
          'rgb(220,38,38)',
          1.0,
          'rgb(159,18,57)',
        ],
      },
    })

    return () => {
      if (map.getLayer('heatmap-layer')) map.removeLayer('heatmap-layer')
      if (map.getSource('heatmap-points')) map.removeSource('heatmap-points')
    }
  }, [mapReady, summary, showHeatmap, heatmapOptions.produtividade])

  return (
    <View
      testID="maps-general"
      dataSet={{ fidelity: 'maps-general' }}
      style={{
        // Full viewport — Maps lives OUTSIDE AppLayout (no parent gives size).
        // position:fixed + inset:0 anchors the root to the viewport directly,
        // avoiding the '100vh' string-on-style problem (RNW drops it → auto height
        // → maplibregl canvas grows past viewport → V scrollbar reserves 15px →
        // visible right-side gap). overflow:hidden clamps any rogue child.
        position: 'fixed' as 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: theme.background,
        overflow: 'hidden',
      }}
    >
      {/* Map full-bleed (z-0) */}
      <div
        ref={containerRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        }}
      />

      {/* Zonas de alerta — elliptical zone outlines stroked in surface/primary
          green (matches Figma 33:3924 "Zonas de alerta" state per Screenshot_43).
          Page-level mock; in production these would come from a maplibre vector
          source (zones drawn as Polygons fed by alert-zone geometry data). */}
      {showHeatmap && heatmapOptions.zonasAlerta ? (
        <>
          <div
            style={{
              position: 'absolute',
              left: '14%',
              top: '52%',
              width: '14%',
              height: '24%',
              borderRadius: '50%',
              border: '3px solid #62bb81',
              boxShadow: '0 0 12px rgba(98, 187, 129, 0.35)',
              pointerEvents: 'none',
              zIndex: 1,
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: '46%',
              top: '32%',
              width: '20%',
              height: '14%',
              borderRadius: '50%',
              border: '3px solid #62bb81',
              boxShadow: '0 0 12px rgba(98, 187, 129, 0.35)',
              pointerEvents: 'none',
              zIndex: 1,
            }}
          />
        </>
      ) : null}

      {/* Top scrim — reproduces the dark fade baked into Figma's mockup
          satellite image (imgMapViewGeneral, node 32:2488). Real ESRI tiles
          lack this built-in contrast, so the Logo + HeaderUserInfo would
          float over bright urban imagery without legibility. pointer-events:
          none keeps the map draggable underneath; z-index 1 sits between map
          and header (z-2). */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 120,
          background: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 100%)',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      />

      {/* Intensity legend — Figma map-view-heat reference: a slim full-height
          vertical gradient bar pinned to the right edge with "Intensity /
          High Red" labels at the top. The "Low" label is intentionally
          omitted to match Figma, where the bar fades into the screen edge.
          No background panel; labels float directly over the satellite
          imagery, kept legible by a strong drop-shadow. The bar lives at
          right:6, width 16, so it occupies x range vp-22..vp-6. Map controls
          now use right:56 (instead of 16) to keep their 48px-wide icons from
          overlapping the bar. The container stops at bottom:114 — just above
          the "Voltar ao dashboard" button (bottom:30 + height ~72 + 12 gap)
          so the gradient doesn't bleed behind it. */}
      {showHeatmap && (heatmapOptions.produtividade || heatmapOptions.zonasAlerta) ? (
        <div
          style={{
            position: 'absolute',
            right: 6,
            top: 90,
            bottom: 114,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 4,
            zIndex: 2,
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontFamily: 'Inter, system-ui, sans-serif',
              fontWeight: 600,
              color: '#f5f5f5',
              letterSpacing: 0.3,
              lineHeight: '14px',
              textShadow: '0 1px 3px rgba(0,0,0,0.9), 0 0 10px rgba(0,0,0,0.6)',
              paddingRight: 4,
            }}
          >
            Intensity
          </span>
          <span
            style={{
              fontSize: 11,
              fontFamily: 'Inter, system-ui, sans-serif',
              fontWeight: 700,
              color: '#fda4af',
              letterSpacing: 0.3,
              lineHeight: '13px',
              textShadow: '0 1px 3px rgba(0,0,0,0.9), 0 0 10px rgba(0,0,0,0.6)',
              paddingRight: 4,
            }}
          >
            High Red
          </span>
          <div
            style={{
              width: 16,
              flex: 1,
              borderRadius: 4,
              background:
                'linear-gradient(180deg, #9f1239 0%, #dc2626 14%, #f97316 32%, #facc15 52%, #22c55e 74%, #22d3ee 100%)',
              boxShadow:
                '0 0 12px rgba(0,0,0,0.7), 0 0 24px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.28)',
              marginTop: 6,
            }}
          />
        </div>
      ) : null}

      {/* Header — Logo left + HeaderUserInfo right */}
      <View
        testID="maps-header"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: theme.padding.xxl,
          paddingVertical: theme.padding.sm,
          zIndex: 2,
        }}
      >
        <Logo type="complete" size="m" />
        <HeaderUserInfo
          bpm={user?.bpm ?? 99}
          pressure={user?.pressure ?? '12/8'}
          progress={50}
          avatarUri={user?.avatarUri ?? workerA}
          heartIconName="heart_filled"
          pressureIconName="vitals_pulse"
          borderColor={theme.background}
          testID="maps-header-user-info"
        />
      </View>

      {/* Compact SideMenu — Figma 165:21148 outer at left:24 + inner left:14 = absolute left:38 */}
      <View
        testID="maps-side-menu"
        style={{
          position: 'absolute',
          left: 38,
          top: 162,
          width: 60,
          zIndex: 2,
        }}
      >
        <SideMenu
          items={NAV}
          value={location.pathname}
          variant="minimal"
          iconSize={20}
          badgePosition="outside-left"
          onChange={(v: string) => navigate(v)}
          fullWidth
          accessibilityLabel="Navegação principal"
        />
      </View>

      {/* Map controls — right. Figma 165:21931 calls for right:16 but we use
          right:56 so the 48px-wide control icons (x range vp-104..vp-56) stay
          clear of the heatmap intensity bar pinned at right:6 (x range
          vp-22..vp-6). Original right:16 made the bar pass behind the icons
          and visually clip them. top:calc(50%-241)=242 at 966h preserved. */}
      <View
        testID="maps-controls"
        style={{
          position: 'absolute',
          right: 56,
          top: 242,
          gap: theme.gap.s,
          alignItems: 'flex-end',
          zIndex: 2,
        }}
      >
        <MapControl
          variant="operators"
          expanded={showOperators}
          onExpandedChange={setShowOperators}
        />
        <MapControl
          variant="heatmap"
          expanded={showHeatmap}
          onExpandedChange={setShowHeatmap}
          options={[
            { id: 'produtividade', label: 'Produtividade', checked: heatmapOptions.produtividade },
            { id: 'zonas-alerta', label: 'Zonas de alerta', checked: heatmapOptions.zonasAlerta },
          ]}
          onOptionChange={(id, checked) =>
            setHeatmapOptions((prev) =>
              id === 'produtividade'
                ? { ...prev, produtividade: checked }
                : { ...prev, zonasAlerta: checked },
            )
          }
        />
        <MapControl variant="cameras" expanded={showCameras} onExpandedChange={setShowCameras} />
      </View>

      {/* Voltar ao dashboard — draggable DS Button (surface variant) with close icon.
          Initial position per Figma 32:2502; can be dragged anywhere in the viewport.
          PanResponder distinguishes tap (no movement past 3px → navigate) from drag. */}
      <View
        {...backBtnPanResponder.panHandlers}
        style={
          {
            position: 'absolute',
            right: backBtnAnchor.right,
            bottom: backBtnAnchor.bottom,
            zIndex: 2,
            cursor: 'grab',
          } as object
        }
      >
        <Button
          variant="surface"
          size="small"
          label="Voltar ao dashboard"
          iconRight={<Icon name="close" size={24} color={theme.content.dark} />}
          onPress={() => navigate('/')}
          accessibilityLabel="Voltar ao dashboard"
          testID="back-to-dashboard"
        />
      </View>
    </View>
  )
}
