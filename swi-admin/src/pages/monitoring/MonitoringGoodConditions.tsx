// src/pages/monitoring/MonitoringGoodConditions.tsx
// Child view for /monitoring/good-conditions. The shared
// chrome (KPIs, title, tabs, search, user list) lives in MonitoringLayout.
// This view contributes only the row of 4 DonutCharts that sits between
// the KPI row and the "Alertas de Desgaste" title. Os números vêm do resumo da
// empresa que o layout já lê, com a legenda pronta do backend.
import { View } from 'react-native'
import { DonutChart, useTheme } from '@kavicki/swi-design-system'
import { buildGoodConditions } from '@/services/monitoring'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useMonitoringContext } from './monitoringContext'

export function MonitoringGoodConditions() {
  const theme = useTheme()
  const breakpoint = useBreakpoint()
  // At wide the donuts share the RIGHT half of the side-by-side layout with
  // the BigNumbers panel on the LEFT. The narrower cells
  // need the small donut variant so titles don't overlap.
  const donutSize = breakpoint === 'wide' ? 'small' : 'default'
  const { summary, failed } = useMonitoringContext()
  const stats = buildGoodConditions(summary, failed)

  // Each card hosts one DS DonutChart at size="default" (182×182 outer /
  // 160 arc / 138 inner well). Cards sit flat on
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
      testID="monitoring-good-conditions"
      style={{
        flexDirection: 'row',
        alignItems: 'stretch',
        gap: theme.gap.m,
        width: '100%',
      }}
    >
      {/* Card 1: sinais vitais dentro dos limites */}
      <View style={cardStyle}>
        <DonutChart
          title="Sinais vitais"
          value={stats.vitals.value}
          label={stats.vitals.label}
          caption={stats.vitals.caption}
          progress={stats.vitals.progress}
          size={donutSize}
          icon="heartbeat"
          progressGradient={[theme.surface.success, theme.surface.primary]}
        />
      </View>

      {/* Card 2: taxa de desgaste */}
      <View style={cardStyle}>
        <DonutChart
          title="Taxa de desgaste"
          value={stats.fatigueRate.value}
          label={stats.fatigueRate.label}
          caption={stats.fatigueRate.caption}
          progress={stats.fatigueRate.progress}
          size={donutSize}
          icon="heartbeat"
          progressGradient={[theme.surface.success, theme.surface.primary]}
        />
      </View>

      {/* Card 3: média de batimentos (cyan→green); o arco é a cobertura */}
      <View style={cardStyle}>
        <DonutChart
          title="Média de batimentos"
          value={stats.heartrate.value}
          label={stats.heartrate.label}
          caption={stats.heartrate.caption}
          progress={stats.heartrate.progress}
          size={donutSize}
          icon="heartbeat"
          progressGradient={[theme.surface.secondary, theme.surface.primary]}
        />
      </View>

      {/* Card 4: alertas urgentes (red arc) */}
      <View style={cardStyle}>
        <DonutChart
          title="Alertas urgentes"
          value={stats.urgentAlerts.value}
          label={stats.urgentAlerts.label}
          caption={stats.urgentAlerts.caption}
          progress={stats.urgentAlerts.progress}
          size={donutSize}
          icon="heartbeat"
          progressGradient={[theme.surface.error, theme.surface.error]}
        />
      </View>
    </View>
  )
}
