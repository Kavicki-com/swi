// src/pages/dashboard/components/DashboardKpis.tsx
// Os quatro indicadores de cabeçalho (administradores, funcionários, novos
// relatórios, câmeras ativas), em grade 2x2 ou em tira 1x4 no viewport wide.
// Extraídos de Dashboard.tsx.
import { View } from 'react-native'
import { Icon, Text, Title, useTheme, type IconName } from '@kavicki/swi-design-system'
import type { DashboardSummary } from '@/services/dashboard'

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
// on wide viewports. Desktop and tablet keep the 2×2 grid that fits next
// to HealthDonuts.
export function FuncionariosKpi({
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
    // directly on the page background to match the spec.
    return (
      <View
        testID="kpi-funcionarios"
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
