// src/app/RouteFallback.tsx
// Estado das fronteiras de Suspense das rotas. Cada página autenticada é
// carregada sob demanda (React.lazy no App), e é isto que aparece entre o
// clique e a chegada do chunk.
//
// Dentro do AppLayout o fallback ocupa só a área de conteúdo, então a sidebar
// e o header continuam na tela durante a troca de página. Nas rotas full-bleed
// (Mapas e Chat), que não têm chrome, ele ocupa a tela inteira.
import { View } from 'react-native'
import { Text, useTheme } from '@kavicki/swi-design-system'

export function RouteFallback() {
  const theme = useTheme()
  return (
    <View
      testID="route-fallback"
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: theme.padding.l,
      }}
    >
      <Text variant="body.m" color={theme.content.medium}>
        Carregando…
      </Text>
    </View>
  )
}
