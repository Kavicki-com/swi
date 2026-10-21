// src/pages/_shared/WorkerFatigueBar.tsx
// Bloco "Tempo até atingir fadiga total" do detalhe de funcionário/admin:
// título, barra em degradê e o rótulo da estimativa. Extraído do
// WorkerDetailsLayout para caber no teto de 800 linhas.
import { View } from 'react-native'
import { Text, useTheme } from '@kavicki/swi-design-system'
import type { WorkerVitalsView } from '@/services/vitals/vitalsView'

/**
 * Minutos que enchem a barra: o mesmo da fórmula (fatigueEtaHorizonMinutes do
 * perfil de avaliação no backend, um turno de oito horas). Acima dele o
 * backend nem devolve estimativa, então a barra cheia é o maior valor possível.
 */
export const FATIGUE_BAR_HORIZON_MIN = 480

export function WorkerFatigueBar({ fatigueEta }: { fatigueEta: WorkerVitalsView['fatigueEta'] }) {
  const theme = useTheme()
  return (
    // Fatigue total time. Pill-rounded
    // outer container (bg=background) with padding.xs inset and an
    // inset drop shadow framing a 6px gradient bar (error→warning→success).
    // Outer container is a <div> because react-native-web View does
    // not pass through `boxShadow: inset ...`.
    <View style={{ gap: theme.gap.s }}>
      <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '700' }}>
        Tempo até atingir fadiga total:
      </Text>
      <div
        style={{
          borderRadius: 999,
          backgroundColor: theme.background,
          paddingLeft: theme.padding.xs,
          paddingRight: theme.padding.xs,
          paddingTop: theme.padding.xs,
          paddingBottom: theme.padding.xs,
          boxShadow: 'inset 0 4px 4px 0 rgba(0,0,0,0.16)',
          overflow: 'hidden',
        }}
      >
        <div
          data-testid="fatigue-bar-fill"
          style={{
            width: `${Math.min(100, ((fatigueEta.minutes ?? 0) / FATIGUE_BAR_HORIZON_MIN) * 100)}%`,
            height: 6,
            borderRadius: 999,
            background: `linear-gradient(90deg, ${theme.surface.error} 0%, ${theme.surface.warning} 45.673%, ${theme.surface.success} 100%)`,
          }}
        />
      </div>
      <Text variant="body.m" color={theme.content.dark}>
        {fatigueEta.label}
      </Text>
    </View>
  )
}
