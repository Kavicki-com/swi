// src/pages/dashboard/Dashboard.tsx
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import {
  ActivitiesOverviewCard,
  BigNumbersCard,
  Button,
  Text,
  Title,
  WeatherTimeline,
  useTheme,
} from '@kavicki/swi-design-system'
import { useAuth } from '@/hooks/useAuth'
import { dashboardApi, type DashboardSummary } from '@/services/mockApi'
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
        <DashboardError
          message={error}
          onRetry={() => setRefetchTrigger((n) => n + 1)}
        />
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

function DashboardError({
  message,
  onRetry,
}: {
  message: string | null
  onRetry: () => void
}) {
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

function formatHourLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
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

      {/* Top KPI row */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: theme.gap.m,
        }}
      >
        <BigNumbersCard
          value={summary.employees.total}
          label="Total funcionários"
          icon="person_apron"
          testID="kpi-total"
        />
        <BigNumbersCard
          value={summary.employees.byStatus.alert}
          label="Em alerta"
          icon="mode_heat"
          testID="kpi-alert"
        />
        <BigNumbersCard
          value={summary.alerts.openOrAcknowledged}
          label="Alertas abertos"
          icon="vital_signs"
          testID="kpi-open-alerts"
        />
        <BigNumbersCard
          value={summary.alerts.bySeverity.critical}
          label="Alertas críticos"
          icon="monitor_heart"
          testID="kpi-critical-alerts"
        />
      </View>

      {/* Workers status breakdown — fall back to BigNumbersCards because
          DS WorkersInfoCard is for a single employee, not a status summary. */}
      <Text>Funcionários por status</Text>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: theme.gap.m,
        }}
      >
        <BigNumbersCard
          value={summary.employees.byStatus.good}
          label="Bem"
          testID="status-good"
        />
        <BigNumbersCard
          value={summary.employees.byStatus.alert}
          label="Em alerta"
          testID="status-alert"
        />
        <BigNumbersCard
          value={summary.employees.byStatus.low}
          label="Baixo"
          testID="status-low"
        />
        <BigNumbersCard
          value={summary.employees.byStatus.offline}
          label="Offline"
          testID="status-offline"
        />
      </View>

      {/* Recent activities */}
      <Text>Atividades recentes</Text>
      <View style={{ gap: theme.gap.s }}>
        {summary.recentActivities.map((activity, idx) => (
          <ActivitiesOverviewCard
            key={activity.id}
            title={activity.label}
            subtitle={formatHourLabel(activity.at)}
            progress={(idx + 1) / summary.recentActivities.length}
            avatars={[]}
            fullWidth
            testID={`activity-${activity.id}`}
          />
        ))}
      </View>

      {/* Weather */}
      <Text>Previsão do tempo</Text>
      <WeatherTimeline events={weatherEvents} testID="weather-timeline" />
    </View>
  )
}
