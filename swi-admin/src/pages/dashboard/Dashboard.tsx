// src/pages/dashboard/Dashboard.tsx
import { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { useNavigate } from 'react-router-dom'
import {
  ActivitiesOverviewCard,
  BigNumbersCard,
  Button,
  ChipGroup,
  EmployeeOverviewCard,
  Icon,
  SearchInput,
  Text,
  Title,
  WeatherTimeline,
  useTheme,
} from '@kavicki/swi-design-system'
import { useAuth } from '@/hooks/useAuth'
import { dashboardApi, type DashboardSummary } from '@/services/mockApi'
import type {
  DashboardActivity,
  DashboardActivityStatus,
  DashboardWearAlert,
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

const formatHourLabel = (iso: string): string =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false })

function MapBanner() {
  const theme = useTheme()
  const navigate = useNavigate()
  return (
    <View
      testID="dashboard-map-banner"
      style={{
        height: 180,
        borderRadius: theme.border.radius.m,
        backgroundColor: theme.surface.medium,
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative' as unknown as never,
        overflow: 'hidden',
      }}
    >
      <Icon name="location_on" size={48} color={theme.content.primary} />
      <View
        style={{
          position: 'absolute' as unknown as never,
          right: theme.padding.m,
          bottom: theme.padding.m,
        }}
      >
        <Button
          label="Acessar mapa"
          variant="contained"
          onPress={() => navigate('/maps/general')}
          testID="dashboard-map-cta"
        />
      </View>
    </View>
  )
}

function FuncionariosKpi({ summary }: { summary: DashboardSummary }) {
  const theme = useTheme()
  const goodCount = summary.employees.byStatus.good
  const alertCount =
    summary.employees.byStatus.alert +
    summary.employees.byStatus.low +
    summary.employees.byStatus.offline
  return (
    <View
      testID="kpi-funcionarios"
      style={{
        flexDirection: 'row',
        gap: theme.gap.s,
        padding: theme.padding.s,
        borderRadius: theme.border.radius.m,
        backgroundColor: theme.surface.standard,
      }}
    >
      <BigNumbersCard
        value={goodCount}
        label="Funcionários"
        icon="person_apron"
        testID="kpi-funcionarios-good"
      />
      <BigNumbersCard
        value={alertCount}
        label="Funcionários"
        icon="mode_heat"
        iconColor={theme.content.warning}
        testID="kpi-funcionarios-alert"
      />
    </View>
  )
}

function UrgentAlertsKpi({ value }: { value: number }) {
  const theme = useTheme()
  return (
    <View testID="kpi-urgent-alerts" style={{ gap: theme.gap.xs }}>
      <BigNumbersCard
        value={value}
        label="Alertas urgentes"
        icon="vital_signs"
        iconColor={theme.content.error}
      />
      <Text style={{ color: theme.content.error, fontSize: 12 }}>Necessita atenção</Text>
    </View>
  )
}

const ACTIVITY_CHIPS = ['Em Curso', 'Concluídas', 'A Fazer', 'Ver Todas'] as const
type ActivityChip = (typeof ACTIVITY_CHIPS)[number]

const CHIP_TO_STATUS: Record<Exclude<ActivityChip, 'Ver Todas'>, DashboardActivityStatus> = {
  'Em Curso': 'em-curso',
  Concluídas: 'concluida',
  'A Fazer': 'a-fazer',
}

function WearAlertsSection({ alerts }: { alerts: DashboardWearAlert[] }) {
  const theme = useTheme()
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return alerts
    return alerts.filter(
      (a) =>
        a.employeeName.toLowerCase().includes(q) || a.sector.toLowerCase().includes(q),
    )
  }, [alerts, query])

  return (
    <View testID="wear-alerts-section" style={{ gap: theme.gap.m }}>
      <Title>Alertas de Desgaste</Title>
      <View testID="wear-alerts-search">
        <SearchInput
          placeholder="Pesquisar Funcionário"
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

function ActivitiesSection({ activities }: { activities: DashboardActivity[] }) {
  const theme = useTheme()
  const [filter, setFilter] = useState<ActivityChip>('Em Curso')

  const filtered = useMemo(() => {
    if (filter === 'Ver Todas') return activities
    const status = CHIP_TO_STATUS[filter]
    return activities.filter((a) => a.status === status)
  }, [activities, filter])

  return (
    <View testID="activities-section" style={{ gap: theme.gap.m }}>
      <Title>Atividades em andamento</Title>
      <View testID="activities-chips">
        <ChipGroup
          options={[...ACTIVITY_CHIPS]}
          mode="single"
          value={filter}
          onChange={(value: string | string[]) => {
            const next = Array.isArray(value) ? value[0] : value
            if (next && (ACTIVITY_CHIPS as readonly string[]).includes(next)) {
              setFilter(next as ActivityChip)
            }
          }}
        />
      </View>
      <View testID="activities-list" style={{ gap: theme.gap.s }}>
        {filtered.length === 0 ? (
          <Text testID="activities-empty">Nenhuma atividade nesta categoria.</Text>
        ) : (
          filtered.map((activity) => (
            <ActivitiesOverviewCard
              key={activity.id}
              title={activity.title}
              subtitle={activity.sector}
              progress={activity.progress}
              avatars={activity.participants}
              totalAvatarsCount={activity.participants.length}
              locationIcon="location_on"
              fullWidth
              testID={`activity-${activity.id}`}
            />
          ))
        )}
      </View>
    </View>
  )
}

function DashboardContent({ summary }: { summary: DashboardSummary }) {
  const theme = useTheme()

  const weatherEvents: WeatherTimelineEvent[] = summary.weather.map((w, idx) => ({
    id: `weather-${idx}`,
    condition: WEATHER_CONDITION_MAP[w.condition],
    time: formatHourLabel(w.at),
    label: `${w.tempC}°C`,
  }))

  return (
    <View testID="dashboard-content" style={{ gap: theme.gap.l }}>
      <Title>Dashboard</Title>

      <MapBanner />

      {/* KPI row — Figma layout: Funcionários composite + Sinais vitais + Taxa de desgaste + Alertas urgentes */}
      <View
        testID="kpi-row"
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: theme.gap.m,
          alignItems: 'flex-start',
        }}
      >
        <FuncionariosKpi summary={summary} />
        <BigNumbersCard
          value={summary.kpis.vitalSigns}
          label="Sinais vitais"
          icon="vital_signs"
          testID="kpi-vital-signs"
        />
        <BigNumbersCard
          value={summary.kpis.wearRate}
          label="Taxa de desgaste"
          icon="health_activity"
          iconColor={theme.content.success}
          testID="kpi-wear-rate"
        />
        <UrgentAlertsKpi value={summary.kpis.urgentAlerts} />
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

      {/* Weather — Task 5 will expand to 5-6 entries with intensitySegments */}
      <Text>Previsão do tempo</Text>
      <WeatherTimeline events={weatherEvents} testID="weather-timeline" />
    </View>
  )
}
