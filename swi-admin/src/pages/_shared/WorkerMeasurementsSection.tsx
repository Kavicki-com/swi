// src/pages/_shared/WorkerMeasurementsSection.tsx
// Faixa "Medições do relógio" do detalhe de funcionário/admin: as medições que
// o cabeçalho de sinais vitais não mostra (oxigenação, temperatura, passos,
// distância, movimento e as referências de batimento). Composição DS, um
// BigNumbersCard por medição com a legenda abaixo.
//
// Só desenha o que o measurementsView decidiu: sem leitura, a frase de
// ausência; valor ausente vira NO_VALUE, nunca um zero inventado; leitura de
// demonstração leva o selo de origem ao lado do título.
import { View } from 'react-native'
import { BigNumbersCard, Text, Title, useTheme } from '@kavicki/swi-design-system'
import { DataOriginBadge } from '@/components/DataOriginBadge'
import type { WorkerMeasurementsView } from '@/services/vitals/measurementsView'
import { NO_VALUE } from '@/services/vitals/vitalsView'

export function WorkerMeasurementsSection({ view }: { view: WorkerMeasurementsView }) {
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
          Medições do relógio
        </Title>
        {/* Leitura de demonstração é declarada, como no card de vitais;
            leitura real do relógio dispensa selo. */}
        {view.kind === 'entries' && view.sourceBadge ? (
          <DataOriginBadge label={view.sourceBadge} testID="measurements-source-badge" />
        ) : null}
      </View>
      {view.kind === 'empty' ? (
        <Text variant="body.s" color={theme.content.medium} testID="measurements-empty">
          {view.message}
        </Text>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap.m }}>
          {view.entries.map((entry) => (
            <View key={entry.key} style={{ gap: theme.gap.xs }}>
              <BigNumbersCard
                value={entry.value ?? NO_VALUE}
                label={entry.label}
                icon={entry.icon}
                testID={`measurement-${entry.key}`}
              />
              {entry.caption !== null ? (
                <Text
                  variant="body.s"
                  color={theme.content.medium}
                  testID={`measurement-${entry.key}-caption`}
                >
                  {entry.caption}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      )}
    </View>
  )
}
