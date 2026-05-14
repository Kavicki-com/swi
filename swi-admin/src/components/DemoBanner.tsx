// src/components/DemoBanner.tsx
// Sits above authenticated routes to remind the client that data on screen
// is demonstrative (seeded fixtures, not live telemetry). The "Resetar demo"
// button clears the auth session in localStorage and reloads, returning the
// user to the /login screen so they can re-enter the demo state from zero.
import { View } from 'react-native'
import { Button, Text, useTheme } from '@kavicki/swi-design-system'

export function DemoBanner() {
  const theme = useTheme()
  function handleReset() {
    window.localStorage.clear()
    window.location.reload()
  }
  return (
    <View
      testID="demo-banner"
      accessibilityRole="alert"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.gap.m,
        paddingHorizontal: theme.padding.m,
        paddingVertical: theme.padding.s,
        backgroundColor: theme.surface.accent,
      }}
    >
      <Text variant="body.s" color={theme.content.light} style={{ fontWeight: '700' }}>
        MODO DEMO — dados de demonstração
      </Text>
      <Button
        label="Resetar demo"
        variant="ghost"
        size="small"
        onPress={handleReset}
        accessibilityLabel="Resetar demo e voltar para a tela de login"
      />
    </View>
  )
}
