import { View } from 'react-native'
import { Icon, Text, useTheme } from '@kavicki/swi-design-system'
import { SIMULATED_DATA_LABEL } from '@/services/vitals/simulatedVitals'

// Selo discreto "Dados simulados". Vai ao lado de QUALQUER superfície que
// exiba vitais simulados: o operador nunca confunde biometria fabricada com
// sinal da smartband. Composição DS (Icon + Text).
export function SimulatedDataBadge() {
  const theme = useTheme()
  return (
    <View
      testID="simulated-data-badge"
      accessibilityLabel={SIMULATED_DATA_LABEL}
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.xs }}
    >
      <Icon name="info" size={14} color={theme.content.medium} />
      <Text variant="body.s" color={theme.content.medium}>
        {SIMULATED_DATA_LABEL}
      </Text>
    </View>
  )
}
