// src/pages/alerts/AlertsList.tsx
// /alerts — Figma 100:5611. Lives inside AppLayout. Static-basemap view:
//   1. SearchInput "Pesquisar" + 4 filter chips (status filter).
//   2. Static satellite image covering the rest of the content area.
//   3. Location pins rendered per worker, colored by their vitals status,
//      positioned by percentage derived from each worker's lat/lng inside
//      a fixed bounding box.
//
// Why static instead of live tiles: the Figma reference is pixel-aligned
// to a specific satellite frame. Live tiles would not match at any zoom,
// so we render the exported image and place pins as absolute overlays.
import { useEffect, useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import { useNavigate, useParams } from 'react-router-dom'
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
import basemapSrc from '@/assets/maps/alerts-basemap.jpg'
import heatmapSrc from '@/assets/maps/alerts-heatmap-basemap.png'
import meteoSrc from '@/assets/maps/alerts-meteo-basemap.png'

// Lat/Lng window the static basemap represents. Picked with padding so the
// seed employees (lat -23.54..-23.58, lng -46.60..-46.66) sit comfortably
// inside the frame instead of bunching on the edges.
const BBOX = {
  minLat: -23.595,
  maxLat: -23.525,
  minLng: -46.675,
  maxLng: -46.585,
}

// Percent-based positioning over the static basemap. The result feeds
// straight into a `style` prop; the literal type matches `DimensionValue`
// from @types/react-native so `left`/`top` typecheck without casts.
function pctFor(
  lat: number,
  lng: number,
): { left: `${number}%`; top: `${number}%` } {
  const x = ((lng - BBOX.minLng) / (BBOX.maxLng - BBOX.minLng)) * 100
  const y = ((BBOX.maxLat - lat) / (BBOX.maxLat - BBOX.minLat)) * 100
  return { left: `${x}%`, top: `${y}%` }
}

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

export function AlertsList() {
  const theme = useTheme()
  const navigate = useNavigate()
  const { employeeId } = useParams<{ employeeId?: string }>()
  const [markers, setMarkers] = useState<DashboardMapMarker[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<string>('all')
  const [mapMode, setMapMode] = useState<'pins' | 'heat' | 'meteo'>('pins')

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
        <img
          src={mapMode === 'heat' ? heatmapSrc : mapMode === 'meteo' ? meteoSrc : basemapSrc}
          alt=""
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />

        {/* Pin layer. Each pin is anchored bottom-center (translateX -20,
            translateY -54) so the tail tip sits exactly on the bbox-projected
            coordinate. */}
        {filteredMarkers.map((m) => {
          const pos = pctFor(m.lat, m.lng)
          return (
            <Pressable
              key={m.id}
              accessibilityLabel={m.name}
              onPress={() => navigate(employeeId === m.id ? '/alerts' : `/alerts/${m.id}`)}
              style={{
                position: 'absolute',
                left: pos.left,
                top: pos.top,
                transform: [{ translateX: -20 }, { translateY: -54 }],
              }}
            >
              <LocationPin variant="badge" status={m.status} name={m.name} />
            </Pressable>
          )
        })}

        {/* Floating mode toggles (Figma 100:5611, top-left over map). */}
        <View
          style={{
            position: 'absolute',
            top: theme.gap.s,
            left: theme.gap.s,
            flexDirection: 'row',
            gap: theme.gap.xs,
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

        {/* Alerts-rescue-route overlay (Figma 101:7209). Positioned by the
            same percent system the pins use, with a small offset so the
            card sits above-right of its pin. Skipped on the meteo basemap
            for red pins — that combo shows the weather toast instead. */}
        {selectedMarker && !(mapMode === 'meteo' && selectedMarker.status === 'low') ? (
          <View
            style={{
              position: 'absolute',
              left: pctFor(selectedMarker.lat, selectedMarker.lng).left,
              top: pctFor(selectedMarker.lat, selectedMarker.lng).top,
              transform: [{ translateX: 8 }, { translateY: -120 }],
              maxWidth: 602,
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
        {mapMode === 'meteo' && selectedMarker?.status === 'low' ? (
          <View
            style={{
              position: 'absolute',
              left: pctFor(selectedMarker.lat, selectedMarker.lng).left,
              top: pctFor(selectedMarker.lat, selectedMarker.lng).top,
              transform: [{ translateX: 8 }, { translateY: -90 }],
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.gap.m,
              padding: theme.padding.s,
              borderRadius: theme.border.radius.m,
              backgroundColor: theme.surface.errorLight,
              maxWidth: 460,
            }}
          >
            <Icon name="rainy" size={24} color={theme.content.light} />
            <View style={{ flex: 1, gap: theme.gap.xs }}>
              <Text variant="body.s" color={theme.content.light} style={{ fontWeight: '700' }}>
                Alerta de Chuvas intensas
              </Text>
              <Text variant="body.s" color={theme.content.light}>
                O colaborador José Santos Setor f32 - está em risco
              </Text>
            </View>
            <Button label="Evacuar área" backgroundColor={theme.surface.error} />
          </View>
        ) : null}
      </View>
    </View>
  )
}
