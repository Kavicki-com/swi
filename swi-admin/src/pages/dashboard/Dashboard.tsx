// src/pages/dashboard/Dashboard.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useLivePositions } from '@/hooks/useLivePositions'
import { useDemoToast } from '@/lib/demoToast'
import {
  dashboardApi,
  type DashboardActivity,
  type DashboardActivityRisk,
  type DashboardActivityStatus,
  type DashboardMapMarker,
  type DashboardSummary,
  type DashboardWearAlert,
} from '@/services/dashboard'
import { FormError } from '@/components/FormError'
import { SimulatedDataBadge } from '@/components/SimulatedDataBadge'

// DS module is shimmed to `any`; mirror the WeatherTimelineEvent shape locally.
type WeatherTimelineCondition = 'sunny' | 'rainy' | 'partly-cloudy' | 'storm'
type WeatherTimelineEvent = {
  id: string
  condition: WeatherTimelineCondition
  isNight?: boolean
  time: string
  label: string
  isNow?: boolean
}

const WEATHER_NOW_LABEL = 'AGORA'
// surface/success (lime/700) -> surface/success-light (lime/200) — Sinais vitais.
const VITAL_GRADIENT = ['#3EAB2E', '#B7E9A4'] as const
// surface/info (blue/600) -> surface/info-light (blue/200) — Taxa de desgaste (Figma).
const WEAR_GRADIENT = ['#3899BF', '#8AD2E2'] as const
// content/error (red/400) -> surface/error-light (red/200) — Alertas urgentes.
const URGENT_GRADIENT = ['#F5667A', '#FAB3BD'] as const

type Phase = 'loading' | 'error' | 'populated'

export function Dashboard() {
  const { user } = useAuth()
  // Posições REAIS ao vivo (REST + WS) — splicadas sobre o summary no render;
  // o resto do summary continua vindo do fan-out.
  const liveMarkers = useLivePositions()
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
      {phase === 'populated' && summary && (
        <DashboardContent summary={{ ...summary, mapMarkers: liveMarkers ?? [] }} />
      )}
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
  cloudy: 'partly-cloudy',
  rain: 'rainy',
  storm: 'storm',
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

function MapBanner({
  markers,
  height = 172,
}: {
  markers: DashboardMapMarker[]
  // Figma frame 4:2 (1366) → 172. Figma frame 1060:7080 (1920 wide) → ~268.
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
      dataSet={{ fidelity: 'map-banner' }}
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
      <Text variant="body.s" numberOfLines={1} color={theme.content.dark}>
        {label}
      </Text>
    </View>
  )
}

// Wide-class variant lays the 4 KPI tiles in a single horizontal strip
// (Figma 1060:7080). Desktop and tablet keep the 2×2 grid that fits next
// to HealthDonuts.
function FuncionariosKpi({
  summary,
  layout = '2x2',
}: {
  summary: DashboardSummary
  layout?: '2x2' | '1x4'
}) {
  const theme = useTheme()
  const { admins, totalEmployees, newReports, activeCameras } = summary.kpis
  if (layout === '1x4') {
    // Wide variant: no surface wrapper around the strip — tiles sit
    // directly on the page background to match Figma 1060:7080.
    return (
      <View
        testID="kpi-funcionarios"
        dataSet={{ fidelity: 'kpi-1x4' }}
        style={{
          flexDirection: 'row',
          gap: theme.gap.s,
        }}
      >
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
    )
  }
  return (
    <View
      testID="kpi-funcionarios"
      style={{
        gap: theme.gap.s,
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
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: theme.gap.s,
        }}
      >
        <Title variant="title.s">Alertas de Desgaste</Title>
        {/* Fase 3: desgaste deriva de vitais SIMULADOS (funcionários reais). */}
        <SimulatedDataBadge />
      </View>
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
          <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '700' as const }}>
            {activity.title}
          </Text>
          <Text variant="body.s" color={theme.content.medium}>
            {activity.sector}
          </Text>
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
      <Title variant="title.s">Atividades em andamento</Title>
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

function HealthDonuts({
  summary,
  navigate,
  theme,
  flat = false,
}: {
  summary: DashboardSummary
  navigate: ReturnType<typeof useNavigate>
  theme: ReturnType<typeof useTheme>
  // When true the wrapper drops its surface background / padding / radius
  // so the donut cards sit directly on the page bg. Used in the wide
  // dashboard variant where the section panel is intentionally absent.
  flat?: boolean
}) {
  return (
    <View
      testID="kpi-row-health"
      style={{
        flex: 1,
        flexDirection: 'row',
        gap: theme.gap.m,
        justifyContent: 'space-around',
        minWidth: 0,
        ...(flat
          ? null
          : {
              backgroundColor: theme.surface.standard,
              padding: theme.padding.m,
              borderRadius: theme.border.radius.l,
            }),
      }}
    >
      <DonutChart
        title="Sinais vitais"
        value={summary.kpis.vitalSigns}
        label="Funcionários"
        caption="Excelentes"
        progress={85}
        progressGradient={VITAL_GRADIENT}
        icon="heartbeat_filled"
        iconColor={theme.surface.success}
        iconGradient={VITAL_GRADIENT}
        size="small"
        onLocationPress={() => navigate('/maps/general')}
        locationAccessibilityLabel="Abrir localização no mapa"
        testID="kpi-vital-signs"
      />
      <DonutChart
        title="Taxa de desgaste"
        value={summary.kpis.wearRate}
        label="Funcionários"
        caption="Desgastados"
        progress={70}
        progressGradient={WEAR_GRADIENT}
        icon="heartbeat_filled"
        iconColor={theme.surface.success}
        iconGradient={VITAL_GRADIENT}
        size="small"
        onLocationPress={() => navigate('/maps/general')}
        locationAccessibilityLabel="Abrir localização no mapa"
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
        iconColor={theme.surface.success}
        iconGradient={VITAL_GRADIENT}
        size="small"
        onLocationPress={() => navigate('/maps/general')}
        locationAccessibilityLabel="Abrir localização no mapa"
        testID="kpi-urgent-alerts"
      />
    </View>
  )
}

function DashboardContent({ summary }: { summary: DashboardSummary }) {
  const theme = useTheme()
  const navigate = useNavigate()
  const breakpoint = useBreakpoint()

  const weatherEvents: WeatherTimelineEvent[] = summary.weather.map((w, idx) => ({
    id: `weather-${idx}`,
    condition: WEATHER_CONDITION_MAP[w.condition],
    isNight: w.isNight,
    time: formatHourLabel(w.at),
    label: w.label ?? `${w.tempC}°C`,
    isNow: w.isNow,
  }))

  const weatherStrip = (
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
  )

  // Tablet (< 1024): everything stacks into one column. The KPI 2x2 and the
  // donut row keep their internal layouts (already responsive); we just
  // stack their containers on top of each other, and the two-col row
  // becomes two stacked sections.
  if (breakpoint === 'tablet') {
    return (
      <View testID="dashboard-content" style={{ gap: theme.gap.l }}>
        <MapBanner markers={summary.mapMarkers} />
        <View
          testID="dashboard-top-row-tablet"
          dataSet={{ fidelity: 'top-row-tablet' }}
          style={{ flexDirection: 'column', gap: theme.gap.m }}
        >
          <FuncionariosKpi summary={summary} />
          <HealthDonuts summary={summary} navigate={navigate} theme={theme} flat />
        </View>
        <View
          testID="dashboard-two-col-row"
          dataSet={{ fidelity: 'two-col-tablet' }}
          style={{ flexDirection: 'column', gap: theme.gap.l }}
        >
          <ActivitiesSection activities={summary.activities} />
          <WearAlertsSection alerts={summary.wearAlerts} />
        </View>
        {weatherStrip}
      </View>
    )
  }

  // Wide (>= 1600): top row puts Map | Donuts | KPIs side-by-side in one
  // horizontal flow per the Figma 1920 frame. Two-column row below.
  if (breakpoint === 'wide') {
    // Figma 1060:7080 wide dashboard layout:
    //   Row 1 — Map full-width
    //   Row 2 — HealthDonuts (3 charts) | FuncionariosKpi (1x4 horizontal strip)
    //   Row 3 — Atividades em andamento | Alertas de Desgaste
    return (
      <View testID="dashboard-content" style={{ gap: theme.gap.l }}>
        {/* Row 1 — Map spans the full content width. */}
        <View testID="dashboard-top-row-wide" dataSet={{ fidelity: 'top-row-wide' }}>
          <MapBanner markers={summary.mapMarkers} height={268} />
        </View>
        {/* Row 2 — Donuts (left, ~60 %) and 4 KPIs (right, ~40 %). */}
        <View
          testID="dashboard-kpi-row-wide"
          dataSet={{ fidelity: 'kpi-row-wide' }}
          style={{
            flexDirection: 'row',
            gap: theme.gap.m,
            alignItems: 'stretch',
          }}
        >
          <View
            style={{
              flexBasis: 0,
              flexGrow: 1.5,
              flexShrink: 1,
              minWidth: 360,
              flexDirection: 'row',
            }}
          >
            <HealthDonuts summary={summary} navigate={navigate} theme={theme} flat />
          </View>
          <View
            style={{
              flexBasis: 0,
              flexGrow: 1,
              flexShrink: 1,
              minWidth: 320,
              justifyContent: 'center',
            }}
          >
            <FuncionariosKpi summary={summary} layout="1x4" />
          </View>
        </View>
        <View
          testID="dashboard-two-col-row"
          dataSet={{ fidelity: 'two-col-wide' }}
          style={{ flexDirection: 'row', gap: theme.gap.l, alignItems: 'flex-start' }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <ActivitiesSection activities={summary.activities} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <WearAlertsSection alerts={summary.wearAlerts} />
          </View>
        </View>
        {weatherStrip}
      </View>
    )
  }

  // Desktop (1024-1599): existing layout, untouched.
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
        <HealthDonuts summary={summary} navigate={navigate} theme={theme} flat />
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

      {weatherStrip}
    </View>
  )
}
