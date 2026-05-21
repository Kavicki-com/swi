// src/pages/dashboard/Dashboard.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import { useNavigate } from 'react-router-dom'
import type maplibregl from 'maplibre-gl'
import { useMapLibre } from '@/lib/useMapLibre'
import {
  AvatarGroup,
  Button,
  DonutChart,
  EmployeeOverviewCard,
  Icon,
  ProgressBar,
  SearchInput,
  Tabs,
  Text,
  Title,
  WeatherTimeline,
  useTheme,
  type IconName,
} from '@kavicki/swi-design-system'
import { useAuth } from '@/hooks/useAuth'
import { useDemoToast } from '@/lib/demoToast'
import {
  dashboardApi,
  type DashboardActivity,
  type DashboardActivityRisk,
  type DashboardActivityStatus,
  type DashboardMapMarker,
  type DashboardSummary,
  type DashboardWearAlert,
} from '@/services/mockApi/dashboard'
import { FormError } from '@/components/FormError'

// DS module is shimmed to `any`; mirror the WeatherTimelineEvent shape locally.
type WeatherTimelineCondition = 'sunny' | 'rainy' | 'partly-cloudy'
type WeatherTimelineEvent = {
  id: string
  condition: WeatherTimelineCondition
  time: string
  label: string
  isNow?: boolean
}

const WEATHER_NOW_LABEL = 'AGORA'
const WEAR_GRADIENT = ['#34d399', '#10b981'] as const
// surface/error-light -> surface/error from the Figma token map.
const URGENT_GRADIENT = ['#fab3bd', '#f5667a'] as const

type Phase = 'loading' | 'error' | 'populated'

export function Dashboard() {
  const { user } = useAuth()
  const [phase, setPhase] = useState<Phase>('loading')
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refetchTrigger, setRefetchTrigger] = useState(0)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setPhase('loading')
    dashboardApi.summary({ orgId: user.org_id }).then(({ data, error: err }) => {
      if (cancelled) return
      if (data) {
        setSummary(data)
        setPhase('populated')
      } else {
        setError(err?.message ?? 'Falha ao carregar dashboard')
        setPhase('error')
      }
    })
    return () => {
      cancelled = true
    }
  }, [user, refetchTrigger])

  return (
    <View testID="dashboard-page">
      {phase === 'loading' && <DashboardSkeleton />}
      {phase === 'error' && (
        <DashboardError message={error} onRetry={() => setRefetchTrigger((n) => n + 1)} />
      )}
      {phase === 'populated' && summary && <DashboardContent summary={summary} />}
    </View>
  )
}

function DashboardSkeleton() {
  const theme = useTheme()
  const placeholderStyle = {
    height: 96,
    borderRadius: theme.border.radius.m,
    backgroundColor: theme.surface.standard,
  }
  return (
    <View
      testID="dashboard-skeleton"
      style={{ gap: theme.gap.m }}
      accessibilityLabel="Carregando dashboard"
    >
      <View style={placeholderStyle} />
      <View style={placeholderStyle} />
      <View style={placeholderStyle} />
      <View style={placeholderStyle} />
    </View>
  )
}

function DashboardError({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  const theme = useTheme()
  return (
    <View
      testID="dashboard-error"
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.gap.m,
        padding: theme.padding.l,
      }}
    >
      <FormError message={message ?? 'Falha ao carregar dashboard'} />
      <Button label="Tentar novamente" onPress={onRetry} accessibilityLabel="Tentar novamente" />
    </View>
  )
}

const WEATHER_CONDITION_MAP: Record<
  DashboardSummary['weather'][number]['condition'],
  WeatherTimelineEvent['condition']
> = {
  sun: 'sunny',
  rain: 'rainy',
  storm: 'rainy',
}

const formatHourLabel = (iso: string): string => {
  // Figma format: "09:00AM" — 12-hour with AM/PM, no space.
  const d = new Date(iso)
  const hours24 = d.getHours()
  const period = hours24 >= 12 ? 'PM' : 'AM'
  const hours12 = hours24 % 12 || 12
  const minutes = d.getMinutes()
  return `${String(hours12).padStart(2, '0')}:${String(minutes).padStart(2, '0')}${period}`
}

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

function MapBanner({ markers }: { markers: DashboardMapMarker[] }) {
  const theme = useTheme()
  const navigate = useNavigate()
  const lib = useMapLibre()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  useEffect(() => {
    if (!lib || !containerRef.current) return

    // Center on the centroid of markers; fall back to São Paulo if no markers yet.
    const center: [number, number] =
      markers.length > 0
        ? [
            markers.reduce((s, m) => s + m.lng, 0) / markers.length,
            markers.reduce((s, m) => s + m.lat, 0) / markers.length,
          ]
        : [-46.63, -23.55]

    const map = new lib.Map({
      container: containerRef.current,
      style: ESRI_SATELLITE_STYLE,
      center,
      zoom: 13,
      attributionControl: false,
    })
    mapRef.current = map

    map.on('load', () => {
      // Auto-fit to all markers if there are 2+, otherwise stick with the centroid + zoom 13.
      if (markers.length >= 2) {
        const bounds = new lib.LngLatBounds()
        markers.forEach((m) => bounds.extend([m.lng, m.lat]))
        map.fitBounds(bounds, { padding: 60, animate: false, maxZoom: 15 })
      }
    })

    const markerHandles = markers.map((m) =>
      new lib.Marker({
        element: buildMarkerEl(m, () => navigate(`/employees/${m.id}`)),
      })
        .setLngLat([m.lng, m.lat])
        .addTo(map),
    )

    return () => {
      markerHandles.forEach((h) => h.remove())
      map.remove()
      mapRef.current = null
    }
  }, [markers, lib, navigate])

  return (
    <View
      testID="dashboard-map-banner"
      dataSet={{ fidelity: 'map-banner' }}
      style={{
        height: 200,
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
      <View
        style={{
          position: 'absolute' as unknown as never,
          right: theme.padding.m,
          bottom: theme.padding.m,
        }}
      >
        <Button
          label="Ver mapa geral"
          variant="ghost"
          onPress={() => navigate('/maps/general')}
          testID="dashboard-map-cta"
        />
      </View>
    </View>
  )
}

function KpiTile({
  icon,
  value,
  label,
  testID,
}: {
  icon: IconName
  value: number | string
  label: string
  testID?: string
}) {
  const theme = useTheme()
  return (
    <View
      testID={testID}
      style={{
        flex: 1,
        gap: theme.gap.s,
        padding: theme.padding.m,
        borderRadius: theme.border.radius.m,
        backgroundColor: theme.surface.medium,
        minWidth: 0,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={icon} size={24} color={theme.content.primary} />
      <Title variant="title.l">{value}</Title>
      <Text numberOfLines={1} style={{ color: theme.content.dark, fontSize: 12 }}>
        {label}
      </Text>
    </View>
  )
}

function FuncionariosKpi({ summary }: { summary: DashboardSummary }) {
  const theme = useTheme()
  const { admins, totalEmployees, newReports, activeCameras } = summary.kpis
  return (
    <View
      testID="kpi-funcionarios"
      style={{
        gap: theme.gap.s,
        padding: theme.padding.m,
        borderRadius: theme.border.radius.l,
        backgroundColor: theme.surface.standard,
      }}
    >
      <View style={{ flexDirection: 'row', gap: theme.gap.s }}>
        <KpiTile
          icon="account_circle_filled"
          value={admins}
          label="Administradores"
          testID="kpi-funcionarios-admins"
        />
        <KpiTile
          icon="employee_filled"
          value={totalEmployees}
          label="Funcionários"
          testID="kpi-funcionarios-employees"
        />
      </View>
      <View style={{ flexDirection: 'row', gap: theme.gap.s }}>
        <KpiTile
          icon="report_filled"
          value={newReports}
          label="Novos relatórios"
          testID="kpi-funcionarios-reports"
        />
        <KpiTile
          icon="video_camera_filled"
          value={activeCameras}
          label="Câmeras ativas"
          testID="kpi-funcionarios-cameras"
        />
      </View>
    </View>
  )
}

const ACTIVITY_FILTER_CHIPS = ['Em Andamento', 'Concluídas', 'A Fazer'] as const
type ActivityFilterChip = (typeof ACTIVITY_FILTER_CHIPS)[number]
type ActivityFilter = ActivityFilterChip | 'Ver Todos'

const CHIP_TO_STATUS: Record<ActivityFilterChip, DashboardActivityStatus> = {
  'Em Andamento': 'em-curso',
  Concluídas: 'concluida',
  'A Fazer': 'a-fazer',
}

const WEAR_FILTER_TABS = ['Excelentes', 'Desgastados', 'Alertas de Fadiga'] as const
type WearFilterTab = (typeof WEAR_FILTER_TABS)[number]

const WEAR_TAB_TO_TIER: Record<WearFilterTab, DashboardWearAlert['tier']> = {
  Excelentes: 'excelente',
  Desgastados: 'desgastado',
  'Alertas de Fadiga': 'alerta-fadiga',
}

function WearAlertsSection({ alerts }: { alerts: DashboardWearAlert[] }) {
  const theme = useTheme()
  const { show: showToast } = useDemoToast()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<WearFilterTab>('Alertas de Fadiga')

  const filtered = useMemo(() => {
    const tier = WEAR_TAB_TO_TIER[filter]
    const byTab = alerts.filter((a) => a.tier === tier)
    const q = query.trim().toLowerCase()
    if (!q) return byTab
    return byTab.filter(
      (a) => a.employeeName.toLowerCase().includes(q) || a.sector.toLowerCase().includes(q),
    )
  }, [alerts, filter, query])

  return (
    <View
      testID="wear-alerts-section"
      dataSet={{ fidelity: 'wear-alerts' }}
      style={{ gap: theme.gap.m }}
    >
      <Title>Alertas de Desgaste</Title>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.gap.m,
        }}
      >
        <View testID="wear-alerts-tabs" style={{ flex: 1, minWidth: 0 }}>
          <Tabs
            tabs={WEAR_FILTER_TABS.map((t) => ({ value: t, label: t }))}
            value={filter}
            onChange={(v: string) => {
              if ((WEAR_FILTER_TABS as readonly string[]).includes(v)) {
                setFilter(v as WearFilterTab)
              }
            }}
            fullWidth
          />
        </View>
        <Button
          label="Ver Todos"
          variant="contained"
          size="small"
          onPress={() => showToast('Lista completa de funcionários em desgaste')}
          testID="wear-alerts-see-all"
        />
      </View>
      <View testID="wear-alerts-search">
        <SearchInput
          placeholder="Pesquisar funcionário"
          value={query}
          onChangeText={setQuery}
          onClear={() => setQuery('')}
        />
      </View>
      <View testID="wear-alerts-list" style={{ gap: theme.gap.s }}>
        {filtered.length === 0 ? (
          <Text testID="wear-alerts-empty">Nenhum funcionário encontrado.</Text>
        ) : (
          filtered.map((alert) => (
            <EmployeeOverviewCard
              key={alert.id}
              employee={{
                name: alert.employeeName,
                sector: alert.sector,
                avatarUri: alert.avatarUri,
              }}
              progress={alert.progress}
              bpm={alert.bpm}
              pressure={alert.pressure}
              fullWidth
              testID={`wear-alert-${alert.id}`}
            />
          ))
        )}
      </View>
    </View>
  )
}

function progressColorForRisk(
  theme: ReturnType<typeof useTheme>,
  risk: DashboardActivityRisk | undefined,
): string {
  switch (risk) {
    case 'warning':
      return theme.surface.warning
    case 'critical':
      return theme.surface.error
    case 'normal':
    default:
      return theme.surface.primary
  }
}

function ActivityCard({ activity }: { activity: DashboardActivity }) {
  const theme = useTheme()
  const navigate = useNavigate()
  return (
    <View
      testID={`activity-${activity.id}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: theme.padding.m,
        paddingVertical: theme.padding.s,
        borderRadius: theme.border.radius.m,
        backgroundColor: theme.surface.standard,
      }}
    >
      {/* content group: build icon + vertical divider + repair-info column */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.l }}>
        <Icon name="build_filled" size={24} color={theme.content.dark} />
        <View
          style={{
            alignSelf: 'stretch',
            width: 1,
            backgroundColor: theme.content.dark,
            opacity: 0.2,
          }}
        />
        <View style={{ gap: theme.gap.xs }}>
          <Text
            style={{
              color: theme.content.dark,
              fontSize: 14,
              fontWeight: '700' as const,
            }}
          >
            {activity.title}
          </Text>
          <Text style={{ color: theme.content.medium, fontSize: 12 }}>{activity.sector}</Text>
          {/* Figma frame 4:2 ProgressBar is fixed 119px wide; DS ProgressBar
              stretches by default, so wrap to constrain. Color comes from the
              activity's risk level (normal/warning/critical), not its status. */}
          <View style={{ width: 119 }}>
            <ProgressBar
              value={activity.progress}
              color={progressColorForRisk(theme, activity.risk)}
              accessibilityLabel={`${activity.title} progress`}
            />
          </View>
        </View>
      </View>
      <AvatarGroup
        avatars={activity.participants}
        totalCount={activity.totalParticipants ?? activity.participants.length}
        maxVisible={5}
        size="m"
        bordered
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Abrir localização da atividade ${activity.title}`}
        onPress={() => navigate('/maps/general')}
        testID={`activity-${activity.id}-location`}
      >
        <Icon name="location_on_filled" size={24} color={theme.content.dark} />
      </Pressable>
    </View>
  )
}

function ActivitiesSection({ activities }: { activities: DashboardActivity[] }) {
  const theme = useTheme()
  const [filter, setFilter] = useState<ActivityFilter>('Em Andamento')

  const filtered = useMemo(() => {
    if (filter === 'Ver Todos') return activities
    const status = CHIP_TO_STATUS[filter]
    return activities.filter((a) => a.status === status)
  }, [activities, filter])

  return (
    <View
      testID="activities-section"
      dataSet={{ fidelity: 'activities' }}
      style={{ gap: theme.gap.m }}
    >
      <Title>Atividades em andamento</Title>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: theme.gap.m,
        }}
      >
        <View testID="activities-tabs" style={{ flex: 1, minWidth: 0 }}>
          <Tabs
            tabs={ACTIVITY_FILTER_CHIPS.map((c) => ({ value: c, label: c }))}
            value={filter === 'Ver Todos' ? undefined : filter}
            onChange={(v: string) => {
              if ((ACTIVITY_FILTER_CHIPS as readonly string[]).includes(v)) {
                setFilter(v as ActivityFilterChip)
              }
            }}
            fullWidth
          />
        </View>
        <Button
          label="Ver Todos"
          variant="contained"
          size="small"
          onPress={() => setFilter('Ver Todos')}
          testID="activities-see-all"
        />
      </View>
      <View testID="activities-list" style={{ gap: theme.gap.s }}>
        {filtered.length === 0 ? (
          <Text testID="activities-empty">Nenhuma atividade nesta categoria.</Text>
        ) : (
          filtered.map((activity) => <ActivityCard key={activity.id} activity={activity} />)
        )}
      </View>
    </View>
  )
}

function DashboardContent({ summary }: { summary: DashboardSummary }) {
  const theme = useTheme()
  const navigate = useNavigate()

  const weatherEvents: WeatherTimelineEvent[] = summary.weather.map((w, idx) => ({
    id: `weather-${idx}`,
    condition: WEATHER_CONDITION_MAP[w.condition],
    time: formatHourLabel(w.at),
    label: w.label ?? `${w.tempC}°C`,
    isNow: w.isNow,
  }))

  return (
    <View testID="dashboard-content" style={{ gap: theme.gap.l }}>
      <MapBanner markers={summary.mapMarkers} />

      {/* KPI row — Figma: Funcionários composite + Sinais vitais donut + Taxa desgaste donut + Alertas urgentes.
          Right-side donuts share a single dark container that extends to the edge of the right column. */}
      <View
        testID="kpi-row"
        dataSet={{ fidelity: 'kpi-row' }}
        style={{
          flexDirection: 'row',
          gap: theme.gap.m,
          alignItems: 'stretch',
        }}
      >
        <FuncionariosKpi summary={summary} />
        <View
          testID="kpi-row-health"
          style={{
            flex: 1,
            flexDirection: 'row',
            gap: theme.gap.m,
            backgroundColor: theme.surface.standard,
            padding: theme.padding.m,
            borderRadius: theme.border.radius.l,
            justifyContent: 'space-around',
          }}
        >
          <DonutChart
            title="Sinais vitais"
            value={summary.kpis.vitalSigns}
            label="Funcionários"
            caption="Excelentes"
            progress={85}
            icon="heartbeat_filled"
            onLocationPress={() => navigate('/maps/general')}
            testID="kpi-vital-signs"
          />
          <DonutChart
            title="Taxa de desgaste"
            value={summary.kpis.wearRate}
            label="Funcionários"
            caption="Desgaste baixo"
            progress={70}
            progressGradient={WEAR_GRADIENT}
            icon="heartbeat_filled"
            onLocationPress={() => navigate('/maps/general')}
            testID="kpi-wear-rate"
          />
          <DonutChart
            title="Alertas urgentes"
            value={summary.kpis.urgentAlerts}
            label="Funcionários"
            caption="Necessária mobilização"
            progress={60}
            progressGradient={URGENT_GRADIENT}
            icon="heartbeat_filled"
            onLocationPress={() => navigate('/maps/general')}
            testID="kpi-urgent-alerts"
          />
        </View>
      </View>

      {/* Two-column row: Atividades em andamento (left) + Alertas de Desgaste (right) */}
      <View
        testID="dashboard-two-col-row"
        style={{ flexDirection: 'row', gap: theme.gap.l, alignItems: 'flex-start' }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <ActivitiesSection activities={summary.activities} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <WearAlertsSection alerts={summary.wearAlerts} />
        </View>
      </View>

      <View
        dataSet={{ fidelity: 'weather' }}
        style={{ alignSelf: 'stretch', width: '100%', gap: theme.gap.m }}
      >
        <Title>Previsão do tempo</Title>
        <WeatherTimeline
          events={weatherEvents}
          // Figma flex: 280, 280, 280, 528 → ratios 1, 1, 1, 1.886.
          // Colors per Figma: blue (rain), orange (sol intenso), blue (rain), green-dark (parcialmente nublado).
          intensitySegments={[
            { id: 'seg-0', flex: 1, color: '#3899bf' },
            { id: 'seg-1', flex: 1, color: theme.surface.warning },
            { id: 'seg-2', flex: 1, color: '#3899bf' },
            { id: 'seg-3', flex: 1.886, color: theme.surface.success },
          ]}
          // Figma frame 21:1501 — scrubber: 148px thumb on 1037px track ≈ 14%.
          scrollbar={{ thumbPercent: 14, thumbStartPercent: 0 }}
          nowLabel={WEATHER_NOW_LABEL}
          fullWidth
          testID="weather-timeline"
        />
      </View>
    </View>
  )
}
