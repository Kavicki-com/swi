// src/components/VisibilityToggle.tsx
import { Pressable } from 'react-native'
import { Icon, useTheme } from '@kavicki/swi-design-system'

export function VisibilityToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const theme = useTheme()
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={on ? 'Esconder senha' : 'Mostrar senha'}
      style={{ padding: 4 }}
    >
      <Icon name={on ? 'visibility_off' : 'visibility'} size={22} color={theme.content.dark} />
    </Pressable>
  )
}
