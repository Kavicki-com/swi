// src/pages/maps/components/BackToDashboardButton.tsx
// CTA flutuante "Voltar ao dashboard". Extraído de MapsGeneral.tsx sem
// mudança de comportamento: o PanResponder que distingue toque de arrasto
// continua no hook da página, que é quem guarda a âncora.
//
// O testID no wrapper existe para o teste de arrasto: sem ele a suíte
// precisava achar o nó pelo `cursor: grab` do estilo, que é detalhe visual.
import { View, type GestureResponderHandlers } from 'react-native'
import { Button, Icon, useTheme } from '@kavicki/swi-design-system'

export function BackToDashboardButton({
  panHandlers,
  anchor,
  onPress,
}: {
  panHandlers: GestureResponderHandlers
  anchor: { right: number; bottom: number }
  onPress: () => void
}) {
  const theme = useTheme()
  return (
    <View
      testID="back-to-dashboard-drag"
      {...panHandlers}
      style={
        {
          position: 'absolute',
          right: anchor.right,
          bottom: anchor.bottom,
          zIndex: 2,
          cursor: 'grab',
        } as object
      }
    >
      <Button
        variant="surface"
        size="small"
        label="Voltar ao dashboard"
        iconRight={<Icon name="close" size={24} color={theme.content.dark} />}
        onPress={onPress}
        accessibilityLabel="Voltar ao dashboard"
        testID="back-to-dashboard"
      />
    </View>
  )
}
