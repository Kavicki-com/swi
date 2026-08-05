// src/pages/dashboard/components/MapBanner.tsx
// Faixa de mapa do dashboard: tiles de satélite da Esri, um pino por
// funcionário ao vivo, selo de quantos estão na moldura e os CTAs de
// recentralizar e abrir o mapa geral. Extraída de Dashboard.tsx.
import { useCallback, useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { useNavigate } from 'react-router-dom'
import type maplibregl from 'maplibre-gl'
import { useMapLibre } from '@/lib/useMapLibre'
import { Button, Text, useTheme } from '@kavicki/swi-design-system'
import type { DashboardMapMarker } from '@/services/dashboard'

// Esri World Imagery — free satellite tiles, no API key required (attribution required).
// https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9
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

const MARKER_BORDER_BY_STATUS: Record<DashboardMapMarker['status'], string> = {
  good: '#10b981',
  alert: '#f59e0b',
  low: '#ef4444',
  offline: '#6b7280',
}

function buildMarkerEl(marker: DashboardMapMarker, onClick: () => void): HTMLElement {
  const el = document.createElement('div')
  el.style.width = '40px'
  el.style.height = '40px'
  el.style.borderRadius = '50%'
  el.style.backgroundImage = `url("${marker.avatarUri}")`
  el.style.backgroundSize = 'cover'
  el.style.backgroundPosition = 'center'
  el.style.border = `3px solid ${MARKER_BORDER_BY_STATUS[marker.status]}`
  el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.4)'
  el.style.cursor = 'pointer'
  el.title = marker.name
  el.setAttribute('aria-label', `${marker.name} — ${marker.status}`)
  el.addEventListener('click', onClick)
  return el
}

export function MapBanner({
  markers,
  height = 172,
}: {
  markers: DashboardMapMarker[]
  // Reference frame at 1366 → 172; at 1920 wide → ~268.
  // Pass explicitly from the wide branch so the map keeps a sensible aspect
  // ratio when the content column grows past ~1041 CSS px.
  height?: number
}) {
  const theme = useTheme()
  const navigate = useNavigate()
  const lib = useMapLibre()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [mapReady, setMapReady] = useState(false)
  // Enquadra a frota UMA vez, no primeiro lote de markers — depois disso o
  // usuário manda no pan/zoom e os heartbeats só movem os pinos. O simulador
  // MOVE gente depois do enquadramento inicial, então um pino pode sair da
  // moldura: o selo "N de M visíveis" avisa e o botão "Recentralizar"
  // re-enquadra sob demanda (QA 2026-07-26 — decisão do usuário: botão +
  // contador; nada de mapa se movendo sozinho).
  const didFitRef = useRef(false)
  const [visibleCount, setVisibleCount] = useState(0)
  // O handler de moveend precisa do lote ATUAL sem re-registrar listener.
  const markersRef = useRef<DashboardMapMarker[]>([])

  // Enquadra o lote atual. Usada no fit inicial e no botão "Recentralizar" —
  // MESMA moldura nos dois caminhos, senão o botão "corrige" pra outro corte.
  const fitToMarkers = useCallback(() => {
    const map = mapRef.current
    const current = markersRef.current
    if (!lib || !map || current.length === 0) return
    if (current.length >= 2) {
      const bounds = new lib.LngLatBounds()
      current.forEach((m) => bounds.extend([m.lng, m.lat]))
      map.fitBounds(bounds, { padding: 60, animate: false, maxZoom: 15 })
    } else {
      map.setCenter([current[0]!.lng, current[0]!.lat])
    }
  }, [lib])

  // Quantos do lote atual caem na moldura atual. Roda no moveend (pan/zoom do
  // usuário ou fitBounds) e a cada heartbeat — é o que alimenta o selo.
  const recountVisible = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const bounds = map.getBounds()
    setVisibleCount(markersRef.current.filter((m) => bounds.contains([m.lng, m.lat])).length)
  }, [])

  // Mapa nasce uma vez. Com posições ao vivo, depender de `markers` aqui
  // destruiria/recriaria o banner (flash de tiles) a cada heartbeat de 3s.
  useEffect(() => {
    if (!lib || !containerRef.current) return
    const map = new lib.Map({
      container: containerRef.current,
      style: ESRI_SATELLITE_STYLE,
      // Fallback São Paulo até o primeiro snapshot chegar e enquadrar.
      center: [-46.63, -23.55],
      zoom: 13,
      attributionControl: false,
    })
    mapRef.current = map
    map.on('load', () => setMapReady(true))
    map.on('moveend', recountVisible)
    return () => {
      map.remove()
      mapRef.current = null
      setMapReady(false)
      didFitRef.current = false
    }
  }, [lib, recountVisible])

  useEffect(() => {
    const map = mapRef.current
    if (!lib || !map || !mapReady || markers.length === 0) return

    markersRef.current = markers
    if (!didFitRef.current) {
      didFitRef.current = true
      fitToMarkers()
    }

    const markerHandles = markers.map((m) =>
      new lib.Marker({
        element: buildMarkerEl(m, () => navigate(`/employees/${m.id}`)),
      })
        .setLngLat([m.lng, m.lat])
        .addTo(map),
    )
    // O heartbeat move pinos sem mexer na câmera — reconta a cada lote.
    recountVisible()

    return () => {
      markerHandles.forEach((h) => h.remove())
    }
  }, [markers, mapReady, lib, navigate, fitToMarkers, recountVisible])

  return (
    <View
      testID="dashboard-map-banner"
      style={{
        height,
        borderRadius: theme.border.radius.m,
        overflow: 'hidden',
        position: 'relative' as unknown as never,
      }}
    >
      <div
        ref={containerRef}
        data-testid="dashboard-map-canvas"
        style={{ width: '100%', height: '100%' }}
      />
      {/* Selo de honestidade: só aparece quando o simulador tirou alguém da
          moldura — "9 de 9" o tempo todo seria ruído (mesmo princípio do
          badge de fadiga do monitoramento). */}
      {markers.length > 0 && visibleCount < markers.length ? (
        <View
          accessibilityLabel={`${visibleCount} de ${markers.length} funcionários visíveis no mapa`}
          testID="dashboard-map-visible-count"
          style={{
            position: 'absolute' as unknown as never,
            left: theme.padding.m,
            top: theme.padding.m,
            backgroundColor: theme.background,
            borderRadius: theme.border.radius.m,
            paddingHorizontal: theme.padding.sm,
            paddingVertical: theme.padding.s,
          }}
        >
          <Text variant="body.s" color={theme.content.dark} style={{ fontWeight: '700' }}>
            {`${visibleCount} de ${markers.length} visíveis`}
          </Text>
        </View>
      ) : null}
      <View
        style={{
          position: 'absolute' as unknown as never,
          right: theme.padding.m,
          bottom: theme.padding.m,
          flexDirection: 'row',
          gap: theme.gap.s,
        }}
      >
        <Button
          label="Recentralizar"
          variant="contained"
          size="small"
          backgroundColor={theme.background}
          labelColor={theme.content.dark}
          accessibilityLabel="Recentralizar o mapa na equipe"
          onPress={fitToMarkers}
          testID="dashboard-map-refit"
        />
        <Button
          label="Ver mapa geral"
          variant="contained"
          size="small"
          backgroundColor={theme.background}
          labelColor={theme.content.dark}
          onPress={() => navigate('/maps/general')}
          testID="dashboard-map-cta"
        />
      </View>
    </View>
  )
}
