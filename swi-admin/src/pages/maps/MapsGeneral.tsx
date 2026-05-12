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
  icon: string
  badge?: string
}

const NAV: ReadonlyArray<NavItem> = [
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

      {/* Map controls — right. Figma 165:21931: right:16, top:calc(50%-241)=242 at 966h.
          Operators toggle drives showOperators (pin visibility). */}
      <View
        testID="maps-controls"
        style={{
          position: 'absolute',
          right: 16,
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
        <MapControl variant="heatmap" defaultExpanded={false} />
        <MapControl variant="cameras" defaultExpanded={false} />
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
