// src/pages/dashboard/Dashboard.tsx
// Casca do dashboard: carrega o summary, escolhe entre esqueleto, erro e
// conteúdo, e monta as três variantes de layout (tablet, desktop, wide).
// Cada seção mora em components/.
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useNavigate } from 'react-router-dom'
import { Button, useTheme } from '@kavicki/swi-design-system'
import { useAuth } from '@/hooks/useAuth'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useLivePositions } from '@/hooks/useLivePositions'
import { dashboardApi, type DashboardSummary } from '@/services/dashboard'
import { FormError } from '@/components/FormError'
import { ActivitiesSection } from './components/ActivitiesSection'
import { FuncionariosKpi } from './components/DashboardKpis'
import { HealthDonuts } from './components/HealthDonuts'
import { MapBanner } from './components/MapBanner'
import { WearAlertsSection } from './components/WearAlertsSection'
import { WeatherStrip } from './components/WeatherStrip'

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
    dashboardApi.summary().then(({ data, error: err }) => {
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

function DashboardContent({ summary }: { summary: DashboardSummary }) {
  const theme = useTheme()
  const navigate = useNavigate()
  const breakpoint = useBreakpoint()

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
          style={{ flexDirection: 'column', gap: theme.gap.m }}
        >
          <FuncionariosKpi summary={summary} />
          <HealthDonuts summary={summary} navigate={navigate} theme={theme} flat />
        </View>
        <View
          testID="dashboard-two-col-row"
          style={{ flexDirection: 'column', gap: theme.gap.l }}
        >
          <ActivitiesSection activities={summary.activities} />
          <WearAlertsSection alerts={summary.wearAlerts} />
        </View>
        <WeatherStrip weather={summary.weather} />
      </View>
    )
  }

  // Wide (>= 1600): top row puts Map | Donuts | KPIs side-by-side in one
  // horizontal flow per the 1920px reference frame. Two-column row below.
  if (breakpoint === 'wide') {
    // Wide dashboard layout:
    //   Row 1 — Map full-width
    //   Row 2 — HealthDonuts (3 charts) | FuncionariosKpi (1x4 horizontal strip)
    //   Row 3 — Atividades em andamento | Alertas de Desgaste
    return (
      <View testID="dashboard-content" style={{ gap: theme.gap.l }}>
        {/* Row 1 — Map spans the full content width. */}
        <View testID="dashboard-top-row-wide">
          <MapBanner markers={summary.mapMarkers} height={268} />
        </View>
        {/* Row 2 — Donuts (left, ~60 %) and 4 KPIs (right, ~40 %). */}
        <View
          testID="dashboard-kpi-row-wide"
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
          style={{ flexDirection: 'row', gap: theme.gap.l, alignItems: 'flex-start' }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <ActivitiesSection activities={summary.activities} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <WearAlertsSection alerts={summary.wearAlerts} />
          </View>
        </View>
        <WeatherStrip weather={summary.weather} />
      </View>
    )
  }

  // Desktop (1024-1599): existing layout, untouched.
  return (
    <View testID="dashboard-content" style={{ gap: theme.gap.l }}>
      <MapBanner markers={summary.mapMarkers} />

      {/* KPI row: Funcionários composite + Sinais vitais donut + Taxa desgaste donut + Alertas urgentes.
          Right-side donuts share a single dark container that extends to the edge of the right column. */}
      <View
        testID="kpi-row"
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

      <WeatherStrip weather={summary.weather} />
    </View>
  )
}
