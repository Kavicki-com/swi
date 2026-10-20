// src/pages/_shared/WorkerVitalsCard.tsx
// Card de vitais do detalhe de funcionário/admin: frequência cardíaca, pressão
// e estado da leitura sobre o degradê, mais o selo de origem quando a leitura é
// de demonstração. Extraído do WorkerDetailsLayout para caber no teto de 800
// linhas.
import { View } from 'react-native'
import { Icon, Text, Title, useTheme } from '@kavicki/swi-design-system'
import { DataOriginBadge } from '@/components/DataOriginBadge'
import { NO_VALUE, type WorkerVitalsView } from '@/services/vitals/vitalsView'

export function WorkerVitalsCard({ vitals }: { vitals: WorkerVitalsView }) {
  const theme = useTheme()
  return (
    <>
      {/* Combined vitals card. Linear gradient
          from surface.primary (green) to surface.secondary (blue). Web-only
          <div> wrapper because react-native-web View strips the
          `background` shorthand needed for linear-gradient. */}
      <div
        data-testid="vitals-card"
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: theme.gap.s,
          background: `linear-gradient(to right, ${theme.surface.primary}, ${theme.surface.secondary})`,
          borderRadius: theme.border.radius.m,
          paddingLeft: 40,
          paddingRight: theme.padding.m,
          paddingTop: theme.padding.s,
          paddingBottom: theme.padding.s,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="heart_filled" size={20} color={theme.content.light} />
            <Text variant="body.s" color={theme.content.light} style={{ fontWeight: '700' }}>
              {`${vitals.heartRate ?? NO_VALUE} `}
              <Text variant="body.s" color={theme.content.light}>
                bpm
              </Text>
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="vitals_pulse" size={20} color={theme.content.light} />
            <Text variant="body.s" color={theme.content.light} style={{ fontWeight: '700' }}>
              {vitals.pressure ?? NO_VALUE}
            </Text>
          </View>
        </View>
        {/* Estado da LEITURA, não da saúde: juízo de saúde só com as
            condições do backend. */}
        <Title variant="title.xs" color={theme.content.light}>
          {vitals.status}
        </Title>
      </div>

      {/* Leitura de demonstração é declarada; leitura real do relógio
          dispensa selo. */}
      {vitals.sourceBadge ? (
        <View style={{ alignItems: 'flex-end' }}>
          <DataOriginBadge label={vitals.sourceBadge} testID="vitals-source-badge" />
        </View>
      ) : null}
    </>
  )
}
