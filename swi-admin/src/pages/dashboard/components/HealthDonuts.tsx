// src/pages/dashboard/components/HealthDonuts.tsx
// Os três donuts de saúde da frota: sinais vitais, taxa de desgaste e
// alertas urgentes. Recebe os números já decididos a partir da telemetria
// (dashboardHealth) e `navigate` e `theme` por prop, como no original.
import { View } from 'react-native'
import type { useNavigate } from 'react-router-dom'
import { DonutChart, type useTheme } from '@kavicki/swi-design-system'
import type { HealthDonuts as HealthDonutsData } from '../dashboardHealth'

export function HealthDonuts({
  donuts,
  navigate,
  theme,
  flat = false,
}: {
  donuts: HealthDonutsData
  navigate: ReturnType<typeof useNavigate>
  theme: ReturnType<typeof useTheme>
  // When true the wrapper drops its surface background / padding / radius
  // so the donut cards sit directly on the page bg. Used in the wide
  // dashboard variant where the section panel is intentionally absent.
  flat?: boolean
}) {
  // Gradientes pelos tokens: sinais vitais em verde, desgaste em azul e
  // urgência em vermelho, os mesmos tons do Figma.
  const vitalGradient = [theme.surface.success, theme.surface.successLight] as const
  const wearGradient = [theme.surface.info, theme.surface.infoLight] as const
  const urgentGradient = [theme.content.error, theme.surface.errorLight] as const

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
        value={donuts.vitalSigns.value}
        label="Funcionários"
        caption={donuts.vitalSigns.caption}
        progress={donuts.vitalSigns.progress}
        progressGradient={vitalGradient}
        icon="heartbeat_filled"
        iconColor={theme.surface.success}
        iconGradient={vitalGradient}
        size="small"
        onLocationPress={() => navigate('/maps/general')}
        locationAccessibilityLabel="Abrir localização no mapa"
        testID="kpi-vital-signs"
      />
      <DonutChart
        title="Taxa de desgaste"
        value={donuts.wear.value}
        label="Funcionários"
        caption={donuts.wear.caption}
        progress={donuts.wear.progress}
        progressGradient={wearGradient}
        icon="heartbeat_filled"
        iconColor={theme.surface.success}
        iconGradient={vitalGradient}
        size="small"
        onLocationPress={() => navigate('/maps/general')}
        locationAccessibilityLabel="Abrir localização no mapa"
        testID="kpi-wear-rate"
      />
      <DonutChart
        title="Alertas urgentes"
        value={donuts.urgentAlerts.value}
        label="Funcionários"
        caption={donuts.urgentAlerts.caption}
        progress={donuts.urgentAlerts.progress}
        progressGradient={urgentGradient}
        icon="heartbeat_filled"
        iconColor={theme.surface.success}
        iconGradient={vitalGradient}
        size="small"
        onLocationPress={() => navigate('/maps/general')}
        locationAccessibilityLabel="Abrir localização no mapa"
        testID="kpi-urgent-alerts"
      />
    </View>
  )
}
