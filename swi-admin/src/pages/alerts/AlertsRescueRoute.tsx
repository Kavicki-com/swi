// src/pages/alerts/AlertsRescueRoute.tsx
// /alerts/:employeeId/rescue/:rescuerId. Maplibre map with
// real ESRI satellite tiles + 2 pins (rescuer + injured) + a GeoJSON
// LineString route + 3 inline distance/time labels tracked to fractional
// route waypoints + a centered confirmation modal.
//
// Dispatched state (URL `?dispatched=true`):
//   - Pre-dispatch: cyan route, green rescuer pin, modal visible.
//   - Dispatched: violet route, small violet "moving" rescuer marker, no modal.
import { useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import { useParams, useSearchParams } from 'react-router-dom'
import { createRoot, type Root } from 'react-dom/client'
import type maplibregl from 'maplibre-gl'
import { useMapLibre } from '@/lib/useMapLibre'
import { SATELLITE_STYLE } from '@/lib/mapStyles'
import { MapAttribution } from '@/components/MapAttribution'
import { useRescueRoute } from '@/hooks/useRescueRoute'
import { useLivePositions } from '@/hooks/useLivePositions'
import { lngLatAlongLineString, totalLineLength } from '@/lib/lineString'
import { formatDuration, formatDistance } from '@/lib/formatRoute'
import { useDemoToast } from '@/lib/demoToast'
import {
  Button,
  Icon,
  LocationPin,
  SwiThemeProvider,
  Text,
  Title,
  useTheme,
} from '@kavicki/swi-design-system'

type LngLat = [number, number]

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
  const { employeeId, rescuerId } = useParams<{ employeeId?: string; rescuerId?: string }>()
  // Dispatched state is persisted in the URL (`?dispatched=true`) so a
  // refresh of /alerts/:employeeId/rescue/:rescuerId?dispatched=true
  // returns the user to the post-Continuar view
  // (alerts-rescue-ongoing). The modal opens on the pre-dispatch view
  // only.
  const [searchParams, setSearchParams] = useSearchParams()
  const dispatched = searchParams.get('dispatched') === 'true'
  const [modalVisible, setModalVisible] = useState(!dispatched)
  const routeStroke = dispatched ? '#8B5CF6' : '#2BA8C9'

  // Pontas REAIS do socorro: as posições ao vivo do ferido (:employeeId) e do
  // socorrista escolhido (:rescuerId). Antes eram duas constantes fixas — o
  // mapa desenhava sempre a MESMA rota de 2,5 km enquanto a tela anterior
  // dizia "0,02 Km / 1 minuto" pro mesmo par (QA 2026-07-26).
  //
  // Congelamos no primeiro instante em que as duas posições são conhecidas: o
  // simulador move os pinos a cada 3 s e re-pedir a rota a cada tick faria a
  // linha piscar (e martelaria a Directions API). Uma rota de socorro é, por
  // definição, calculada no momento do despacho.
  const positions = useLivePositions()
  const [ends, setEnds] = useState<{ injured: LngLat; rescuer: LngLat } | null>(null)
  useEffect(() => {
    if (ends || !positions) return
    const i = positions.find((p) => p.id === employeeId)
    const r = positions.find((p) => p.id === rescuerId)
    if (i && r) setEnds({ injured: [i.lng, i.lat], rescuer: [r.lng, r.lat] })
  }, [positions, employeeId, rescuerId, ends])

  const lib = useMapLibre()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [mapReady, setMapReady] = useState(false)
  // Keyed by `t` (the fractional position along the route) — always unique
  // among the 3 labels even when their displayed text collides (e.g. "…"
  // during loading or "—" during error fallback).
  const [labelPos, setLabelPos] = useState<Record<number, { left: number; top: number }>>({})

  // Mapbox Directions API: rescuer -> injured. Replaces the previous
  // hardcoded 3-point LineString with a real road-following polyline +
  // real ETA/distance values. Loading + error states are handled below.
  const { route, loading, error } = useRescueRoute(ends?.rescuer ?? null, ends?.injured ?? null)
  const { show: showToast } = useDemoToast()

  // Surface the error to the user once per occurrence (no re-toast on
  // re-renders). The fallback geometry + euclidean-distance labels
  // already keep the UI usable; this is just disclosure.
  useEffect(() => {
    if (error) {
      showToast('Rota indisponível', 'Exibindo linha direta entre os dois pontos.')
    }
  }, [error, showToast])

  // GeoJSON coords driving both the line layer and the label positions.
  // Falls back to a straight 2-point LineString while route is loading
  // or failed — keeps the UI usable, swaps in the real polyline once
  // the API resolves.
  const coords = useMemo<Array<LngLat>>(() => {
    if (!ends) return []
    if (!route) return [ends.rescuer, ends.injured]
    return route.geometry.coordinates.map((c) => [c[0]!, c[1]!] as LngLat)
  }, [route, ends])

  // 3 floating labels anchored at fractional positions along the route.
  // While the Mapbox response is in-flight, show "..." placeholders so the
  // UI always communicates that there ARE labels there. Once resolved,
  // values come straight from duration (seconds) + distance (metres).
  // Error case (route===null after loading=false) is handled in C2.
  const labels = useMemo(() => {
    if (loading || !ends) {
      return [
        { t: 0.25, text: '…' },
        { t: 0.55, text: '…' },
        { t: 0.78, text: '…' },
      ]
    }
    if (route) {
      return [
        { t: 0.25, text: formatDuration(route.duration * 0.4) },
        { t: 0.55, text: formatDistance(route.distance) },
        { t: 0.78, text: formatDuration(route.duration) },
      ]
    }
    // Error fallback: no ETA available, but estimate distance from the
    // straight-line geometry. 1° lat ≈ 111 km globally; lng° varies with
    // latitude but at -23.5° the error is < 10%, fine for the demo label.
    const distMeters = totalLineLength([ends.rescuer, ends.injured]) * 111000
    return [
      { t: 0.25, text: '—' },
      { t: 0.55, text: formatDistance(distMeters) },
      { t: 0.78, text: '—' },
    ]
  }, [route, loading, ends])

  // Init the map once — frame both pins inside view via fitBounds.
  useEffect(() => {
    if (!lib || !containerRef.current || !ends) return
    const map = new lib.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: [(ends.injured[0] + ends.rescuer[0]) / 2, (ends.injured[1] + ends.rescuer[1]) / 2],
      zoom: 15,
      attributionControl: false,
    })
    mapRef.current = map
    map.on('load', () => {
      const bounds = new lib.LngLatBounds()
      bounds.extend(ends.rescuer)
      bounds.extend(ends.injured)
      map.fitBounds(bounds, { padding: 100, animate: false, maxZoom: 16 })
      setMapReady(true)
    })
    return () => {
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [lib, ends])

  // Mount the 2 pins. The rescuer pin's appearance is dispatched-state
  // dependent (badge before / moving square after).
  useEffect(() => {
    const map = mapRef.current
    if (!lib || !map || !mapReady || !ends) return
    const rescuer = dispatched ? buildDispatchedRescuerMarker(lib) : buildBadgePin('good', lib)
    rescuer.marker.setLngLat(ends.rescuer).addTo(map)

    const injured = buildBadgePin('low', lib)
    injured.marker.setLngLat(ends.injured).addTo(map)

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
  }, [lib, mapReady, dispatched, ends])

  // Add the route as a GeoJSON LineString layer. Stroke color reflects the
  // dispatched state (cyan → violet). Coordinates come from the Mapbox
  // Directions response (or fallback to a straight line while loading).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || coords.length < 2) return
    const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
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
        // Fade the provisional straight-line fallback while the real route
        // is loading — communicates "this is temporary" without dropping
        // the line entirely (jarring).
        'line-opacity': loading ? 0.4 : 1.0,
      },
    })
    return () => {
      // During unmount the parent init-effect cleanup may have already
      // called map.remove(), nulling its internal style. Guarding with
      // try/catch lets us idempotently remove on coord/route changes
      // (alive map) without crashing on full teardown (dead map).
      try {
        if (map.getLayer('rescue-route-layer')) map.removeLayer('rescue-route-layer')
        if (map.getSource('rescue-route')) map.removeSource('rescue-route')
      } catch {
        /* map already destroyed */
      }
    }
  }, [mapReady, routeStroke, coords, loading])

  // Track label screen positions — recompute on every map move/zoom so the
  // distance/time labels stay glued to their fractional points along the
  // (possibly multi-segment) route geometry.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || coords.length < 2) return
    const update = () => {
      const next: Record<number, { left: number; top: number }> = {}
      labels.forEach((l) => {
        const [lng, lat] = lngLatAlongLineString(coords, l.t)
        const p = map.project([lng, lat])
        next[l.t] = { left: p.x, top: p.y }
      })
      setLabelPos(next)
    }
    update()
    map.on('move', update)
    map.on('zoom', update)
    return () => {
      // Same teardown race as the route-layer effect: parent unmount may
      // have already called map.remove() by the time this fires.
      try {
        map.off('move', update)
        map.off('zoom', update)
      } catch {
        /* map already destroyed */
      }
    }
  }, [mapReady, labels, coords])

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

      {/* Mandatory ESRI attribution (bottom-right, non-interactive). */}
      <MapAttribution />

      {/* Sem posição conhecida das duas pontas não existe rota: dizer isso é
          melhor que desenhar um trajeto plausível entre coordenadas erradas. */}
      {!ends && positions ? (
        <View
          testID="alerts-rescue-route-sem-posicao"
          style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text variant="body.m" color={theme.content.dark}>
            Posição ao vivo indisponível para o par selecionado.
          </Text>
        </View>
      ) : null}

      {/* Inline distance/time labels — one per waypoint, tracked via map.project */}
      {labels.map((l) => {
        const pos = labelPos[l.t]
        if (!pos) return null
        return (
          <View
            key={l.t}
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

      {modalVisible && ends ? (
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
