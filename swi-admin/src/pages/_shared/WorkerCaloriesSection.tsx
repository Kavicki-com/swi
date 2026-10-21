// src/pages/_shared/WorkerCaloriesSection.tsx
// Seção "Gasto calórico" do detalhe de funcionário/admin: título, seletor de
// período e o gráfico de linha. Extraída do WorkerDetailsLayout para caber no
// teto de 800 linhas e isolar o gráfico.
//
// A curva liga os pontos por cima das horas sem medição (connectAcrossGaps):
// o painel mostra a tendência, mesmo com buraco (MEL-06). Período sem nenhuma
// medição não desenha zeros: vira a frase de `emptyMessage`.
import { View } from 'react-native'
import { Combobox, LineCaloriesChart, Text, Title, useTheme } from '@kavicki/swi-design-system'
import { PERIOD_FROM_OPTION, type CaloriesPoint } from '@/services/vitals/caloriesSeries'
import { WorkerCalibrationLine } from './WorkerCalibrationLine'

type Period = keyof typeof PERIOD_FROM_OPTION

export function WorkerCaloriesSection({
  points,
  period,
  onPeriodChange,
  emptyMessage,
  usualRange = null,
}: {
  points: CaloriesPoint[]
  period: Period
  onPeriodChange: (period: Period) => void
  emptyMessage: string | null
  /** Faixa habitual do dia pela calibração individual, sem zona: o dia ainda corre. */
  usualRange?: string | null
}) {
  const theme = useTheme()
  return (
    <View style={{ gap: theme.gap.m }}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'flex-start',
          alignItems: 'center',
          gap: theme.gap.s,
          // Sobe a linha do título acima do card do gráfico para o painel aberto
          // do Combobox flutuar por cima em vez de ser pintado embaixo.
          position: 'relative',
          zIndex: 10,
        }}
      >
        <Title variant="title.s" color={theme.content.dark}>
          Gasto calórico
        </Title>
        <View style={{ width: 227 }}>
          <Combobox
            options={[
              { label: 'Hoje', value: 'today' },
              { label: 'Esta semana', value: 'week' },
              { label: 'Este mês', value: 'month' },
            ]}
            value={period}
            onChange={(value) => {
              if (value in PERIOD_FROM_OPTION) onPeriodChange(value as Period)
            }}
            accessibilityLabel="Período do gasto calórico"
          />
        </View>
      </View>
      <WorkerCalibrationLine
        line={{ zone: null, limits: usualRange }}
        testIDPrefix="activeEnergy"
        align="flex-start"
      />
      {emptyMessage === null ? (
        <View testID="calories-chart">
          <LineCaloriesChart points={points} unit="kcal" fullWidth connectAcrossGaps />
        </View>
      ) : (
        <View
          testID="calories-empty"
          style={{
            backgroundColor: theme.surface.medium,
            borderRadius: theme.border.radius.l,
            padding: theme.padding.m,
            alignItems: 'center',
          }}
        >
          <Text variant="body.m" color={theme.content.medium}>
            {emptyMessage}
          </Text>
        </View>
      )}
    </View>
  )
}
