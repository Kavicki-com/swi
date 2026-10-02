// src/pages/dashboard/components/WearAlertsSection.tsx
// Bloco de alertas de desgaste: abas por faixa, busca por nome ou setor e um
// EmployeeOverviewCard por funcionário, a partir da leitura real da
// telemetria (dashboardHealth). Extraído de Dashboard.tsx.
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
import { DataOriginBadge } from '@/components/DataOriginBadge'
import { DEMO_DATA_LABEL } from '@/services/vitals/vitalsView'
import type { WearRow, WearTier } from '../dashboardHealth'

const WEAR_FILTER_TABS = ['Excelentes', 'Desgastados', 'Alertas de Fadiga'] as const
type WearFilterTab = (typeof WEAR_FILTER_TABS)[number]

// Excelentes: batimento atual, nenhuma condição de saúde e nenhum caminho até
// o alerta de desgaste. Desgastados: o ritmo atual leva ao alerta de
// desgaste (o backend estima os minutos). Alertas de Fadiga: condição
// urgente ou de saúde aberta.
const WEAR_TAB_TO_TIER: Record<WearFilterTab, WearTier> = {
  Excelentes: 'excelente',
  Desgastados: 'desgastado',
  'Alertas de Fadiga': 'alerta-fadiga',
}

export type WearReadingStatus = 'loading' | 'failed' | 'ready'

const STATUS_TEXT: Record<Exclude<WearReadingStatus, 'ready'>, string> = {
  loading: 'Carregando leitura',
  failed: 'Leitura indisponível no momento',
}

export function WearAlertsSection({
  rows,
  status,
}: {
  rows: WearRow[]
  status: WearReadingStatus
}) {
  const theme = useTheme()
  const { show: showToast } = useDemoToast()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<WearFilterTab>('Alertas de Fadiga')

  const filtered = useMemo(() => {
    const tier = WEAR_TAB_TO_TIER[filter]
    const byTab = rows.filter((r) => r.tier === tier)
    const q = query.trim().toLowerCase()
    if (!q) return byTab
    return byTab.filter(
      (r) => r.employeeName.toLowerCase().includes(q) || r.sector.toLowerCase().includes(q),
    )
  }, [rows, filter, query])

  // Quem não tem leitura atual não cabe em nenhuma faixa, mas não some: a
  // lista diz quantos são.
  const unread = rows.filter((r) => r.tier === null).length
  const anyPaired = rows.some((r) => r.paired)

  const statusText =
    status !== 'ready'
      ? STATUS_TEXT[status]
      : !anyPaired
        ? 'Nenhum funcionário com aparelho pareado.'
        : null

  return (
    <View testID="wear-alerts-section" style={{ gap: theme.gap.m }}>
      <Title variant="title.s">Alertas de Desgaste</Title>
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
      {statusText ? (
        <Text testID="wear-alerts-status" color={theme.content.medium}>
          {statusText}
        </Text>
      ) : (
        <View testID="wear-alerts-list" style={{ gap: theme.gap.s }}>
          {filtered.length === 0 ? (
            <Text testID="wear-alerts-empty">Nenhum funcionário encontrado.</Text>
          ) : (
            filtered.map((row) => <WearCard key={row.id} row={row} />)
          )}
          {unread > 0 ? (
            <Text testID="wear-alerts-unread" variant="body.s" color={theme.content.medium}>
              {unread === 1
                ? '1 funcionário sem leitura atual'
                : `${unread} funcionários sem leitura atual`}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  )
}

function WearCard({ row }: { row: WearRow }) {
  const theme = useTheme()
  // Sem batimento ou pressão conhecidos o cartão do DS mostra a ausência; a
  // tela nunca passa zero no lugar.
  return (
    <View style={{ gap: theme.gap.xs }}>
      <EmployeeOverviewCard
        employee={{
          name: row.employeeName,
          sector: row.sector,
          avatarUri: row.avatarUri,
        }}
        progress={row.progress}
        bpm={row.bpm}
        pressure={row.pressure}
        fullWidth
        testID={`wear-alert-${row.id}`}
      />
      {row.demo ? (
        <View style={{ alignItems: 'flex-end' }}>
          <DataOriginBadge label={DEMO_DATA_LABEL} testID={`wear-alert-${row.id}-demo`} />
        </View>
      ) : null}
    </View>
  )
}
