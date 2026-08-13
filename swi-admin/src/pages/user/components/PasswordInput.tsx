// src/pages/user/components/PasswordInput.tsx
// Campo de senha com o olho de visibilidade sobreposto. Extraído de
// UserSettings.tsx sem mudança de comportamento.
import { Pressable, View } from 'react-native'
import { Icon, Input, useTheme } from '@kavicki/swi-design-system'

// Password field with absolutely-positioned visibility toggle.
// Workaround for a DS Input bug where iconRight overflows the text-area
// horizontally when the input is narrow. We render the DS Input on its own
// (no iconRight) and overlay a Pressable with the eye icon, anchored to the
// right edge of the input box. Stays inside the column at any width.
export function PasswordInput({
  label,
  value,
  onChangeText,
  visible,
  onToggleVisible,
  testID,
}: {
  label: string
  value: string
  onChangeText: (next: string) => void
  visible: boolean
  onToggleVisible: () => void
  testID?: string
}) {
  const theme = useTheme()
  return (
    <View style={{ position: 'relative' }}>
      <Input
        label={label}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={!visible}
        testID={testID}
      />
      {/* Anchored to the right edge of the visible text-area. Wrapper's
          bottom matches the text-area bottom (DS Input renders label above
          + text-area below, no description). The text-area is 41px tall and
          the eye is 24px tall, so to vertically center the eye inside the
          text-area we offset (41-24)/2 ≈ 8px from the wrapper bottom. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Ocultar senha' : 'Mostrar senha'}
        onPress={onToggleVisible}
        style={{
          position: 'absolute',
          right: theme.padding.sm,
          bottom: theme.padding.s,
          width: 24,
          height: 24,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon
          name={visible ? 'visibility_off' : 'visibility'}
          size={20}
          color={theme.content.dark}
        />
      </Pressable>
    </View>
  )
}
