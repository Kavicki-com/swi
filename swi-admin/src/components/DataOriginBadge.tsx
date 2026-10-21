import { View } from 'react-native'
import { Icon, Text, useTheme } from '@kavicki/swi-design-system'

// Selo discreto de origem do dado. Marca a leitura que não é sinal ao vivo do
// aparelho: a de demonstração, a da pulseira sincronizada em lote pelo Android
// (até quando há dado e quando sincronizou) e a estimativa provisória. Assim o
// operador nunca a confunde com o relógio em tempo real. Composição DS (Icon + Text).
export function DataOriginBadge({
  label,
  testID = 'data-origin-badge',
}: {
  label: string
  testID?: string
}) {
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
