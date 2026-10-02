import { View } from 'react-native'
import { Icon, Text, useTheme } from '@kavicki/swi-design-system'

// Selo discreto de origem do dado. Marca a leitura que não vem do aparelho
// real (hoje, a de demonstração), para o operador nunca confundi-la com sinal
// do relógio. Composição DS (Icon + Text).
export function DataOriginBadge({ label, testID = 'data-origin-badge' }: { label: string; testID?: string }) {
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
