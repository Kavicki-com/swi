// src/pages/_shared/WorkerCalibrationLine.tsx
// Linha da calibração individual abaixo da legenda de um card do perfil: o
// selo da zona de agora (StatusTag do DS) e a faixa da pessoa em frase (Text
// do DS). Composição de componentes do DS, sem primitiva própria; só desenha
// o que o calibrationView decidiu, e nada quando a linha vem vazia.
import { View } from 'react-native'
import { StatusTag, Text, useTheme } from '@kavicki/swi-design-system'
import type { CalibrationLine } from '@/services/vitals/calibrationView'

export function WorkerCalibrationLine({
  line,
  testIDPrefix,
  align = 'center',
}: {
  line: CalibrationLine
  /** Prefixo dos testIDs: "<prefixo>-zone" e "<prefixo>-limits". */
  testIDPrefix: string
  /** Centrado sob as roscas; à esquerda sob o card de vitais. */
  align?: 'center' | 'flex-start'
}) {
  const theme = useTheme()
  if (line.zone === null && line.limits === null) return null
  return (
    <View style={{ gap: theme.gap.xs, alignItems: align }}>
      {line.zone ? (
        // O StatusTag se prende à esquerda (alignSelf próprio) e ignora o
        // alignItems daqui; o invólucro, do tamanho do selo, é quem centra.
        <View testID={`${testIDPrefix}-zone-wrap`} style={{ alignSelf: align }}>
          <StatusTag
            status={line.zone.status}
            label={line.zone.label}
            testID={`${testIDPrefix}-zone`}
          />
        </View>
      ) : null}
      {line.limits ? (
        <Text
          variant="body.s"
          color={theme.content.medium}
          style={{ textAlign: align === 'center' ? 'center' : 'left' }}
          testID={`${testIDPrefix}-limits`}
        >
          {line.limits}
        </Text>
      ) : null}
    </View>
  )
}
