// src/pages/alerts/AlertsRescueRoute.tsx
// /alerts/:employeeId/rescue/:rescuerId — Figma 101:7936. Maplibre map with
// real ESRI satellite tiles + 2 pins (rescuer + injured) + a GeoJSON
// LineString route + 3 inline distance/time labels tracked to fractional
// route waypoints + a centered confirmation modal (Figma 101:8167).
//
// Dispatched state (URL `?dispatched=true`):
//   - Pre-dispatch: cyan route, green rescuer pin, modal visible.
//   - Dispatched: violet route, small violet "moving" rescuer marker, no modal.
import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { useParams, useSearchParams } from 'react-router-dom'
import { createRoot, type Root } from 'react-dom/client'
import type maplibregl from 'maplibre-gl'
import { useMapLibre } from '@/lib/useMapLibre'
import {
  Button,
  Icon,
  LocationPin,
  SwiThemeProvider,
  Text,
  Title,
  useTheme,
} from '@kavicki/swi-design-system'

// Real-world coords for the rescue scenario. Placed in the same São Paulo
// operational area used by /maps/general and /alerts so the whole demo
// feels like one mine site.
const INJURED_LNGLAT: [number, number] = [-46.62, -23.545]
const RESCUER_LNGLAT: [number, number] = [-46.64, -23.555]

// Route waypoints — a slight curve through a midpoint offset south so the
// path mimics a road following terrain instead of a straight line. The
// extra waypoints also give us anchor lat/lngs for the inline distance
// labels (computed via fractional interpolation below).
const ROUTE_MID: [number, number] = [
  (INJURED_LNGLAT[0] + RESCUER_LNGLAT[0]) / 2,
  (INJURED_LNGLAT[1] + RESCUER_LNGLAT[1]) / 2 - 0.003,
]
const ROUTE_COORDS: Array<[number, number]> = [RESCUER_LNGLAT, ROUTE_MID, INJURED_LNGLAT]

// Pick a lat/lng at a fractional position (0 = rescuer end, 1 = injured end)
// along the simple 3-point path, used to anchor text labels to map space.
function lngLatAt(t: number): [number, number] {
  if (t <= 0.5) {
    const u = t / 0.5
    return [
      RESCUER_LNGLAT[0] + (ROUTE_MID[0] - RESCUER_LNGLAT[0]) * u,
      RESCUER_LNGLAT[1] + (ROUTE_MID[1] - RESCUER_LNGLAT[1]) * u,
    ]
  }
  const u = (t - 0.5) / 0.5
  return [
    ROUTE_MID[0] + (INJURED_LNGLAT[0] - ROUTE_MID[0]) * u,
    ROUTE_MID[1] + (INJURED_LNGLAT[1] - ROUTE_MID[1]) * u,
  ]
}

const LABELS: Array<{ t: number; text: string }> = [
  { t: 0.25, text: '6 minutos' },
  { t: 0.55, text: '16 Km' },
  { t: 0.78, text: '17 minutos' },
]

const ESRI_SATELLITE_STYLE = {
  version: 8 as const,
  sources: {
    'esri-imagery': {
      type: 'raster' as const,
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: '',
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

type PinHandle = { marker: maplibregl.Marker; root: Root; el: HTMLDivElement }

// LocationPin (badge variant) rendered into a detached div for maplibre's
// HTMLElement-based Marker. SwiThemeProvider supplies the styled-components
// theme to the detached React tree.
function buildBadgePin(status: 'good' | 'low', lib: typeof maplibregl): PinHandle {
  const el = document.createElement('div')
  const root = createRoot(el)
  root.render(
    <SwiThemeProvider>
      <LocationPin variant="badge" status={status} />
    </SwiThemeProvider>,
  )
  const marker = new lib.Marker({ element: el, anchor: 'bottom' })
  return { marker, root, el }
}

// Small violet "moving" marker shown after dispatch — solid square with
// directions_walk icon, anchored center (no tail). Replaces the rescuer's
// badge pin when ?dispatched=true.
function buildDispatchedRescuerMarker(lib: typeof maplibregl): PinHandle {
  const el = document.createElement('div')
  const root = createRoot(el)
  root.render(
    <SwiThemeProvider>
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 4,
          backgroundColor: '#8B5CF6',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="directions_walk" size={20} color="#f5f5f5" />
      </View>
    </SwiThemeProvider>,
  )
  const marker = new lib.Marker({ element: el, anchor: 'center' })
  return { marker, root, el }
}

export function AlertsRescueRoute() {
  const theme = useTheme()
  const { rescuerId } = useParams<{ employeeId?: string; rescuerId?: string }>()
  // Dispatched state is persisted in the URL (`?dispatched=true`) so a
  // refresh of /alerts/:employeeId/rescue/:rescuerId?dispatched=true
  // returns the user to the post-Continuar view (Figma 101:8359
  // alerts-rescue-ongoing). The modal opens on the pre-dispatch view
  // only.
  const [searchParams, setSearchParams] = useSearchParams()
  const dispatched = searchParams.get('dispatched') === 'true'
  const [modalVisible, setModalVisible] = useState(!dispatched)
  const routeStroke = dispatched ? '#8B5CF6' : '#2BA8C9'

  const lib = useMapLibre()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [labelPos, setLabelPos] = useState<Record<string, { left: number; top: number }>>({})

  // Init the map once — frame both pins inside view via fitBounds.
  useEffect(() => {
    if (!lib || !containerRef.current) return
    const map = new lib.Map({
      container: containerRef.current,
      style: ESRI_SATELLITE_STYLE,
      center: [
        (INJURED_LNGLAT[0] + RESCUER_LNGLAT[0]) / 2,
        (INJURED_LNGLAT[1] + RESCUER_LNGLAT[1]) / 2,
      ],
      zoom: 15,
      attributionControl: false,
    })
    mapRef.current = map
    map.on('load', () => {
      const bounds = new lib.LngLatBounds()
      bounds.extend(RESCUER_LNGLAT)
      bounds.extend(INJURED_LNGLAT)
      map.fitBounds(bounds, { padding: 100, animate: false, maxZoom: 16 })
      setMapReady(true)
    })
    return () => {
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [lib])

  // Mount the 2 pins. The rescuer pin's appearance is dispatched-state
  // dependent (badge before / moving square after).
  useEffect(() => {
    const map = mapRef.current
    if (!lib || !map || !mapReady) return
    const rescuer = dispatched ? buildDispatchedRescuerMarker(lib) : buildBadgePin('good', lib)
    rescuer.marker.setLngLat(RESCUER_LNGLAT).addTo(map)

    const injured = buildBadgePin('low', lib)
    injured.marker.setLngLat(INJURED_LNGLAT).addTo(map)

    return () => {
      rescuer.marker.remove()
      injured.marker.remove()
      // Defer the React subtree unmount to a microtask — calling
      // root.unmount() synchronously inside a useEffect cleanup that fires
      // during a state-driven re-render logs the "Attempted to synchronously
      // unmount a root while React was already rendering" warning. Microtask
      // defers it past the current render cycle.
      queueMicrotask(() => {
        rescuer.root.unmount()
        rescuer.el.remove()
        injured.root.unmount()
        injured.el.remove()
      })
    }
  }, [lib, mapReady, dispatched])

  // Add the route as a GeoJSON LineString layer. Stroke color reflects the
  // dispatched state (cyan → violet).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: ROUTE_COORDS },
      properties: {},
    }
    if (map.getLayer('rescue-route-layer')) map.removeLayer('rescue-route-layer')
    if (map.getSource('rescue-route')) map.removeSource('rescue-route')
    map.addSource('rescue-route', { type: 'geojson', data: geojson })
    map.addLayer({
      id: 'rescue-route-layer',
      type: 'line',
      source: 'rescue-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': routeStroke,
        'line-width': 4,
      },
    })
    return () => {
      if (map.getLayer('rescue-route-layer')) map.removeLayer('rescue-route-layer')
      if (map.getSource('rescue-route')) map.removeSource('rescue-route')
    }
  }, [mapReady, routeStroke])

  // Track label screen positions — recompute on every map move/zoom so the
  // distance/time labels stay glued to their waypoints on the route.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const update = () => {
      const next: Record<string, { left: number; top: number }> = {}
      LABELS.forEach((l) => {
        const p = map.project(lngLatAt(l.t))
        next[l.text] = { left: p.x, top: p.y }
      })
      setLabelPos(next)
    }
    update()
    map.on('move', update)
    map.on('zoom', update)
    return () => {
      map.off('move', update)
      map.off('zoom', update)
    }
  }, [mapReady])

  return (
    <View
      testID="alerts-rescue-route"
      accessibilityLabel={`Rescue route ${rescuerId ?? ''}`}
      style={{
        flex: 1,
        position: 'relative',
        borderRadius: theme.border.radius.m,
        overflow: 'hidden',
        minHeight: 480,
      }}
    >
      {/* Maplibre map container — fills the parent View. */}
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Inline distance/time labels — one per waypoint, tracked via map.project */}
      {LABELS.map((l) => {
        const pos = labelPos[l.text]
        if (!pos) return null
        return (
          <View
            key={l.text}
            style={{
              position: 'absolute',
              left: pos.left,
              top: pos.top,
              transform: [{ translateX: -40 }, { translateY: -28 }],
              pointerEvents: 'none',
              zIndex: 2,
            }}
          >
            <Text
              variant="body.s"
              color={theme.content.dark}
              style={{
                textShadowColor: 'rgba(0,0,0,0.6)',
                textShadowOffset: { width: 0, height: 1 },
                textShadowRadius: 2,
              }}
            >
              {l.text}
            </Text>
          </View>
        )
      })}

      {modalVisible ? (
        <View
          style={{
            position: 'absolute',
            top: 80,
            left: '50%',
            transform: [{ translateX: -130 }],
            width: 260,
            backgroundColor: theme.surface.standard,
            borderRadius: theme.border.radius.l,
            padding: theme.padding.m,
            gap: theme.gap.m,
            alignItems: 'center',
            zIndex: 3,
          }}
        >
          <Icon name="turn_right" size={24} color={theme.content.dark} />
          <Title
            variant="title.xs"
            color={theme.content.success}
            style={{ textAlign: 'center', width: '100%' }}
          >
            Enviar rota de socorro
          </Title>
          <Text
            variant="body.s"
            color={theme.content.dark}
            style={{ textAlign: 'center', width: '100%' }}
          >
            O colaborador que prestará socorro terá o tempo de trabalho pausado até o resgate
            chegar.
          </Text>
          <View style={{ width: '100%' }}>
            <Button
              label="Continuar"
              // @ts-expect-error labelFamily exists in local DS source; node_modules pin v0.1.35 hasn't received this prop yet.
              labelFamily="title"
              backgroundColor={theme.surface.success}
              onPress={() => {
                setModalVisible(false)
                setSearchParams({ dispatched: 'true' }, { replace: true })
              }}
            />
          </View>
        </View>
      ) : null}
    </View>
  )
}
