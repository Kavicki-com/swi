// src/pages/dashboard/components/HealthDonuts.tsx
// Os três donuts de saúde da frota: sinais vitais, taxa de desgaste e
// alertas urgentes. Recebe `navigate` e `theme` por prop, como no original.
// Extraídos de Dashboard.tsx.
import { View } from 'react-native'
import type { useNavigate } from 'react-router-dom'
import { DonutChart, type useTheme } from '@kavicki/swi-design-system'
import type { DashboardSummary } from '@/services/dashboard'

// surface/success (lime/700) -> surface/success-light (lime/200), Sinais vitais.
const VITAL_GRADIENT = ['#3EAB2E', '#B7E9A4'] as const
// surface/info (blue/600) -> surface/info-light (blue/200), Taxa de desgaste.
const WEAR_GRADIENT = ['#3899BF', '#8AD2E2'] as const
// content/error (red/400) -> surface/error-light (red/200), Alertas urgentes.
const URGENT_GRADIENT = ['#F5667A', '#FAB3BD'] as const

export function HealthDonuts({
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
