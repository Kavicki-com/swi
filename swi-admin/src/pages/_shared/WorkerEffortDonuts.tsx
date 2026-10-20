// src/pages/_shared/WorkerEffortDonuts.tsx
// Par de roscas do detalhe de funcionário/admin: taxa de fadiga (desgaste) e
// esforço realizado. Extraído do WorkerDetailsLayout para caber no teto de 800
// linhas.
import { View } from 'react-native'
import { DonutChart, useTheme } from '@kavicki/swi-design-system'
import { NO_VALUE } from '@/services/vitals/vitalsView'

// Desgaste e esforço já chegam na escala 0-100, não em fração 0-1. formatPct
// só formata: multiplicar por 100 aqui exibiria "8.900,0%". Sem leitura, a
// rosca mostra NO_VALUE e fica vazia em vez de afirmar 0%.
const formatPct = (n: number | null) =>
  n === null
    ? NO_VALUE
    : `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n)}%`

export function WorkerEffortDonuts({
  wearPct,
  effortPct,
}: {
  wearPct: number | null
  effortPct: number | null
}) {
  const theme = useTheme()
  return (
    // Two donuts side by side, each at intrinsic size (size="small", 156 wide),
    // bevel appearance and surface-token gradients. The row sits at the LEFT
    // of the right column so the first card's edge lines up with the vitals,
    // fatigue and allergies stack above; each title stays centered over its
    // chart (DS default).
    <View style={{ flexDirection: 'row', gap: theme.gap.m, alignItems: 'flex-start' }}>
      <DonutChart
        title="Taxa de fadiga"
        value={formatPct(wearPct)}
        // O donut mede UMA pessoa, então a legenda fala do estado dela e
        // não de um KPI de equipe.
        label="Fadiga atual"
        progress={wearPct ?? 0}
        size="small"
        appearance="bevel"
        icon="heartbeat"
        progressGradient={[theme.surface.success, theme.surface.primary]}
      />
      <DonutChart
        title="Esforço realizado"
        value={formatPct(effortPct)}
        label="Esforço feito"
        progress={effortPct ?? 0}
        size="small"
        appearance="bevel"
        icon="heartbeat"
        progressGradient={[theme.surface.info, theme.surface.secondary]}
      />
    </View>
  )
}
