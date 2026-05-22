// src/pages/alerts/AlertsList.tsx
// /alerts — Figma 100:5611. Lives inside AppLayout. Real-tile maplibre map
// with three overlay modes:
//   1. SearchInput "Pesquisar" + 4 filter chips (status filter).
//   2. Maplibre map (ESRI World Imagery satellite tiles) covering the
//      remaining area. Worker pins are real maplibre Markers anchored at
//      each lat/lng, so they pan/zoom with the basemap.
//   3. mapMode toggles in top-left:
//        'heat'  → adds a maplibre heatmap layer (mock GeoJSON points).
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
import type maplibregl from 'maplibre-gl'
import { useMapLibre } from '@/lib/useMapLibre'
import { SATELLITE_STYLE } from '@/lib/mapStyles'
import { buildHeatmapPoints, buildHeatmapGeoJSON, HEATMAP_COLOR_RAMP } from '@/lib/heatmap'
import { createPinElement, type PinElement } from '@/lib/pinFactory'
import { MapAttribution } from '@/components/MapAttribution'
import { getRainViewerLatestRadar } from '@/lib/rainViewer'
import {
  Button,
  Chip,
  EmployeeOverviewCard,
  Icon,
  LocationPin,
  SearchInput,
  Text,
  useTheme,
} from '@kavicki/swi-design-system'
import { dashboardApi, type DashboardMapMarker } from '@/services/mockApi/dashboard'
import { useDemoToast } from '@/lib/demoToast'

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
  if (filter === 'low') return status === 'low' || status === 'offline'
  return true
}

type PinHandle = PinElement & { marker: maplibregl.Marker }

function buildMarker(
  m: DashboardMapMarker,
  map: maplibregl.Map,
  lib: typeof maplibregl,
  onClick: () => void,
): PinHandle {
  const { el, root } = createPinElement({
    onClick,
    content: <LocationPin variant="badge" status={m.status} name={m.name} />,
  })
  const marker = new lib.Marker({ element: el, anchor: 'bottom' })
    .setLngLat([m.lng, m.lat])
    .addTo(map)
  return { marker, root, el }
}

export function AlertsList() {
  const theme = useTheme()
  const navigate = useNavigate()
  const { show: showToast } = useDemoToast()
  const { employeeId } = useParams<{ employeeId?: string }>()
  const [markers, setMarkers] = useState<DashboardMapMarker[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<string>('all')
  const [mapMode, setMapMode] = useState<'pins' | 'heat' | 'meteo'>('pins')

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

  useEffect(() => {
    let cancelled = false
    dashboardApi.summary({ orgId: 'org_seed_1' }).then(({ data }) => {
      if (!cancelled && data) setMarkers([...data.mapMarkers])
    })
    return () => {
      cancelled = true
    }
  }, [])

  const filteredMarkers = useMemo(
    () =>
      markers.filter((m) => {
        if (!passesFilter(m.status, filter)) return false
        if (search.trim() && !m.name.toLowerCase().includes(search.toLowerCase())) return false
        return true
      }),
    [markers, search, filter],
  )

  const selectedMarker = useMemo(
    () => (employeeId ? (markers.find((m) => m.id === employeeId) ?? null) : null),
    [employeeId, markers],
  )

  // Init the map once we have lib + container + at least one marker (so
  // we know where to center). Tear down on unmount.
  useEffect(() => {
    if (!lib || !containerRef.current || markers.length === 0) return
    const center: [number, number] = [
      markers.reduce((s, m) => s + m.lng, 0) / markers.length,
      markers.reduce((s, m) => s + m.lat, 0) / markers.length,
    ]
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
  }, [lib, markers])

  // Render worker pins as maplibre Markers. Re-render when the filtered
  // list changes. Click toggles selection via URL.
  useEffect(() => {
    const map = mapRef.current
    if (!lib || !map || !mapReady) return
    const handles = filteredMarkers.map((m) =>
      buildMarker(m, map, lib, () => {
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
  }, [lib, mapReady, filteredMarkers])

  // Heatmap layer — only when mapMode === 'heat'. Mock points clustered
  // around the markers' centroid produce the same blob shape as MapsGeneral.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || mapMode !== 'heat' || markers.length === 0) return
    const center: [number, number] = [
      markers.reduce((s, m) => s + m.lng, 0) / markers.length,
      markers.reduce((s, m) => s + m.lat, 0) / markers.length,
    ]
    const corePoints = buildHeatmapPoints(center, 220, 0.006)
    const haloPoints = buildHeatmapPoints(center, 280, 0.018)
    const geojson = buildHeatmapGeoJSON([...corePoints, ...haloPoints])
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
      if (map.getLayer('heatmap-layer')) map.removeLayer('heatmap-layer')
      if (map.getSource('heatmap-points')) map.removeSource('heatmap-points')
    }
  }, [mapReady, mapMode, markers])

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
      if (map.getLayer('meteo-layer')) map.removeLayer('meteo-layer')
      if (map.getSource('meteo')) map.removeSource('meteo')
    }
  }, [mapReady, mapMode])

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

      <View style={{ flexDirection: 'row', gap: theme.gap.s, flexWrap: 'wrap' }}>
        {FILTER_CHIPS.map((c) => (
          <Chip
            key={c.value}
            label={c.label}
            variant={filter === c.value ? 'filled' : 'outline'}
            onPress={() => setFilter(c.value)}
          />
        ))}
      </View>

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

        {/* Floating mode toggles (Figma 100:5611, top-left over map). */}
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

        {/* Selected marker overlay (Figma 101:7209). Tracked to its pin via
            map.project() so it follows pan/zoom. Skipped when meteo basemap
            + red pin combo — that case shows the weather toast instead. */}
        {selectedMarker &&
        overlayPos &&
        !(mapMode === 'meteo' && selectedMarker.status === 'low') ? (
          <View
            style={{
              position: 'absolute',
              left: overlayPos.left,
              top: overlayPos.top,
              transform: [{ translateX: 8 }, { translateY: -120 }],
              maxWidth: 602,
              zIndex: 3,
            }}
          >
            <EmployeeOverviewCard
              employee={{
                name: selectedMarker.name,
                sector: 'Setor Leste',
                avatarUri: selectedMarker.avatarUri,
              }}
              progress={84}
              bpm={117}
              pressure="140/110"
              borderColor={theme.content.error}
              actionElement={
                <Button
                  label="Criar rota de socorro"
                  backgroundColor={theme.surface.primary}
                  onPress={() => navigate(`/alerts/${selectedMarker.id}/rescue`)}
                />
              }
            />
          </View>
        ) : null}

        {/* Meteo alert toast (Figma 103:10463 / 103:10746). Surfaces only
            when the meteorologic basemap is active AND a RED pin (status
            'low' — pink/red badge) has been clicked. Re-clicking the same
            pin clears the selection, which dismisses this toast. */}
        {mapMode === 'meteo' && selectedMarker && overlayPos && selectedMarker.status === 'low' ? (
          <View
            style={{
              position: 'absolute',
              left: overlayPos.left,
              top: overlayPos.top,
              transform: [{ translateX: 8 }, { translateY: -90 }],
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.gap.m,
              padding: theme.padding.s,
              borderRadius: theme.border.radius.m,
              backgroundColor: theme.surface.errorLight,
              maxWidth: 460,
              zIndex: 3,
            }}
          >
            <Icon name="rainy" size={24} color={theme.content.light} />
            <View style={{ flex: 1, gap: theme.gap.xs }}>
              <Text
                variant="body.s"
                color={theme.content.light}
                style={{ fontWeight: '700' as const }}
              >
                Alerta de Chuvas intensas
              </Text>
              <Text variant="body.s" color={theme.content.light}>
                O colaborador José Santos Setor f32 - está em risco
              </Text>
            </View>
            <Button
              label="Evacuar área"
              backgroundColor={theme.surface.error}
              onPress={() =>
                showToast('Evacuação iniciada', 'Notificação enviada aos colaboradores da área')
              }
            />
          </View>
        ) : null}
      </View>
    </View>
  )
}
