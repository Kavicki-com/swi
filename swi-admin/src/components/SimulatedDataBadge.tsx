import { View } from 'react-native'
import { Icon, Text, useTheme } from '@kavicki/swi-design-system'
import { SIMULATED_DATA_LABEL } from '@/services/vitals/simulatedVitals'

// Selo discreto de origem do dado. Por padrão diz "Dados simulados" e vai ao
// lado de QUALQUER superfície que exiba vitais simulados: o operador nunca
// confunde biometria fabricada com sinal do aparelho. O mesmo selo, com outro
// rótulo, marca leitura de demonstração. Composição DS (Icon + Text).
export function SimulatedDataBadge({
  label = SIMULATED_DATA_LABEL,
  testID = 'simulated-data-badge',
}: {
  label?: string
  testID?: string
} = {}) {
  const theme = useTheme()
  return (
    <View
      testID={testID}
      accessibilityLabel={label}
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.xs }}
    >
      <Icon name="info" size={14} color={theme.content.medium} />
      <Text variant="body.s" color={theme.content.medium}>
        {label}
      </Text>
    </View>
  )
}
