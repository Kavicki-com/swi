// src/pages/monitoring/MonitoringGoodConditions.tsx
// Child view for /monitoring/good-conditions (Figma 77:16587). The shared
// chrome (KPIs, title, tabs, search, user list) lives in MonitoringLayout.
// This view contributes only the row of 4 DonutCharts that sits between
// the KPI row and the "Alertas de Desgaste" title.
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { DonutChart, useTheme } from '@kavicki/swi-design-system'
import { monitoringApi, type MonitoringGoodConditionsStats } from '@/services/mockApi/monitoring'

export function MonitoringGoodConditions() {
  const theme = useTheme()
  const [stats, setStats] = useState<MonitoringGoodConditionsStats | null>(null)

  useEffect(() => {
    let cancelled = false
    monitoringApi.goodConditionsStats().then(({ data }) => {
      if (!cancelled && data) setStats(data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!stats) return null

  // Each card hosts one DS DonutChart at size="default" (182×182 outer /
  // 160 arc / 138 inner well — matches Figma 77:16613). Cards sit flat on
  // the page background (no individual card surface).
  const cardStyle = {
    paddingHorizontal: theme.padding.m,
    paddingVertical: theme.padding.m,
    alignItems: 'center' as const,
    flex: 1,
    minWidth: 0,
  }

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'stretch',
        gap: theme.gap.m,
        width: '100%',
      }}
    >
      {/* Card 1 — Sinais vitais */}
      <View style={cardStyle}>
        <DonutChart
          title="Sinais vitais"
          value={String(stats.vitals.value)}
          label={stats.vitals.label}
          caption="Excelentes"
          progress={stats.vitals.progress}
          icon="heartbeat"
          progressGradient={[theme.surface.success, theme.surface.primary]}
        />
      </View>

      {/* Card 2 — Taxa de desgaste */}
      <View style={cardStyle}>
        <DonutChart
          title="Taxa de desgaste"
          value={stats.fatigueRate.value}
          label=""
          caption={stats.fatigueRate.label}
          progress={stats.fatigueRate.progress}
          icon="heartbeat"
          progressGradient={[theme.surface.success, theme.surface.primary]}
        />
      </View>

      {/* Card 3 — Média de batimentos (cyan→green) */}
      <View style={cardStyle}>
        <DonutChart
          title="Média de batimentos"
          value={String(stats.heartrate.value)}
          label={stats.heartrate.unit.toUpperCase()}
          caption="Média normal"
          progress={80}
          icon="heartbeat"
          progressGradient={[theme.surface.secondary, theme.surface.primary]}
        />
      </View>

      {/* Card 4 — Alertas urgentes (red arc, small progress) */}
      <View style={cardStyle}>
        <DonutChart
          title="Alertas urgentes"
          value={String(stats.urgentAlerts.value)}
          label="Funcionários"
          caption="Necessária mobilização"
          progress={8}
          icon="heartbeat"
          progressGradient={[theme.surface.error, theme.surface.error]}
        />
      </View>
    </View>
  )
}
