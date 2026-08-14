// src/pages/dashboard/components/WearAlertsSection.tsx
// Bloco de alertas de desgaste: abas por faixa, busca por nome ou setor e um
// EmployeeOverviewCard por funcionário. Extraído de Dashboard.tsx.
import { useMemo, useState } from 'react'
import { View } from 'react-native'
import {
  Button,
  EmployeeOverviewCard,
  SearchInput,
  Tabs,
  Text,
  Title,
  useTheme,
} from '@kavicki/swi-design-system'
import { useDemoToast } from '@/lib/demoToast'
import type { DashboardWearAlert } from '@/services/dashboard'
import { SimulatedDataBadge } from '@/components/SimulatedDataBadge'

const WEAR_FILTER_TABS = ['Excelentes', 'Desgastados', 'Alertas de Fadiga'] as const
type WearFilterTab = (typeof WEAR_FILTER_TABS)[number]

const WEAR_TAB_TO_TIER: Record<WearFilterTab, DashboardWearAlert['tier']> = {
  Excelentes: 'excelente',
  Desgastados: 'desgastado',
  'Alertas de Fadiga': 'alerta-fadiga',
}

export function WearAlertsSection({ alerts }: { alerts: DashboardWearAlert[] }) {
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
        {/* O desgaste deriva de vitais SIMULADOS sobre funcionários reais. */}
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
