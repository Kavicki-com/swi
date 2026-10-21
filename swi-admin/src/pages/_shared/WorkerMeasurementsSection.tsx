// src/pages/_shared/WorkerMeasurementsSection.tsx
// Faixa "Medições do aparelho" do detalhe de funcionário/admin: as roscas de
// taxa de fadiga e esforço realizado e, lado a lado com elas, as medições que
// o cabeçalho de sinais vitais não mostra (oxigenação, temperatura, passos,
// distância, movimento e as referências de batimento). Composição DS, um
// DonutChart por medição, na mesma fileira que quebra linha quando estreita.
//
// Só desenha o que o measurementsView decidiu: sem leitura, a frase de
// ausência; valor ausente vira NO_VALUE, nunca um zero inventado; leitura de
// demonstração leva o selo de origem ao lado do título.
import { View } from 'react-native'
import { DonutChart, Text, Title, useTheme } from '@kavicki/swi-design-system'
import { DataOriginBadge } from '@/components/DataOriginBadge'
import type { ReactNode } from 'react'
import type { CalibrationLine } from '@/services/vitals/calibrationView'
import type { WorkerMeasurementsView } from '@/services/vitals/measurementsView'
import { NO_VALUE, type VitalsCalibration } from '@/services/vitals/vitalsView'
import { WorkerCalibrationLine } from './WorkerCalibrationLine'

// Desgaste e esforço já chegam na escala 0-100, não em fração 0-1. formatPct
// só formata: multiplicar por 100 aqui exibiria "8.900,0%". Sem leitura, a
// rosca mostra NO_VALUE e fica vazia em vez de afirmar 0%.
const formatPct = (n: number | null) =>
  n === null
    ? NO_VALUE
    : `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n)}%`

/**
 * Uma rosca com a linha da calibração abaixo da legenda. O testID da medição
 * fica no invólucro, para a zona e a faixa contarem como parte da rosca. A
 * linha não alarga a coluna: largura zero com mínimo de 100% faz a frase
 * quebrar na largura da rosca, que continua no tamanho intrínseco.
 */
function Measurement({
  testKey,
  line,
  children,
}: {
  testKey: string
  line: CalibrationLine
  children: ReactNode
}) {
  const theme = useTheme()
  return (
    <View testID={`measurement-${testKey}`} style={{ gap: theme.gap.xs, alignItems: 'center' }}>
      {children}
      <View style={{ width: 0, minWidth: '100%' }}>
        <WorkerCalibrationLine line={line} testIDPrefix={testKey} />
      </View>
    </View>
  )
}

export function WorkerMeasurementsSection({
  view,
  wearPct,
  effortPct,
  wearLabel,
  effortLabel,
  calibration,
}: {
  view: WorkerMeasurementsView
  wearPct: number | null
  effortPct: number | null
  /** Rótulos das roscas, decididos pelo vitalsView: ao vivo "Fadiga atual" e
      "Esforço feito"; com a pulseira, o instante medido, porque o valor não é
      de agora. */
  wearLabel: string
  effortLabel: string
  /** Zona e faixa da calibração individual, decididas pelo vitalsView. */
  calibration: VitalsCalibration
}) {
  const theme = useTheme()
  return (
    <View testID="measurements-section" style={{ gap: theme.gap.m }}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: theme.gap.s,
        }}
      >
        <Title variant="title.s" color={theme.content.dark}>
          Medições do aparelho
        </Title>
        {/* Leitura de demonstração é declarada, como no card de vitais;
            leitura real do aparelho dispensa selo. */}
        {view.kind === 'entries' && view.sourceBadge ? (
          <DataOriginBadge label={view.sourceBadge} testID="measurements-source-badge" />
        ) : null}
      </View>
      {view.kind === 'empty' ? (
        // Sem leitura, desgaste e esforço também vêm vazios (as duas visões
        // saem do mesmo current): a frase basta, sem roscas em "--".
        <Text variant="body.s" color={theme.content.medium} testID="measurements-empty">
          {view.message}
        </Text>
      ) : (
        // Cada rosca no tamanho intrínseco (size="small"), aparência bevel e
        // título centrado sobre o gráfico, como no padrão do DS.
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: theme.gap.m,
            alignItems: 'flex-start',
          }}
        >
          <Measurement testKey="wear" line={calibration.wear}>
            <DonutChart
              title="Taxa de fadiga"
              value={formatPct(wearPct)}
              // A rosca mede UMA pessoa, então a legenda fala do estado dela e
              // não de um KPI de equipe.
              label={wearLabel}
              progress={wearPct ?? 0}
              size="small"
              appearance="bevel"
              icon="heartbeat"
              progressGradient={[theme.surface.success, theme.surface.primary]}
            />
          </Measurement>
          <Measurement testKey="effort" line={calibration.effort}>
            <DonutChart
              title="Esforço realizado"
              value={formatPct(effortPct)}
              label={effortLabel}
              progress={effortPct ?? 0}
              size="small"
              appearance="bevel"
              icon="heartbeat"
              progressGradient={[theme.surface.info, theme.surface.secondary]}
            />
          </Measurement>
          {view.entries.map((entry) => (
            <Measurement key={entry.key} testKey={entry.key} line={entry}>
              <DonutChart
                title={entry.label}
                value={entry.value ?? NO_VALUE}
                label={entry.centerLabel}
                caption={entry.caption ?? undefined}
                progress={entry.progress}
                size="small"
                appearance="bevel"
                icon={entry.icon}
                progressGradient={[theme.surface.primary, theme.surface.secondary]}
              />
            </Measurement>
          ))}
        </View>
      )}
    </View>
  )
}
