// Página 404 do painel, para qualquer endereço que não casa com rota nenhuma.
// Sem desenho no Figma: compõe Title, Text e Button do DS como estão, com o
// mesmo texto da tela de não encontrado do app.
import { View } from 'react-native'
import { useNavigate } from 'react-router-dom'
import { Button, Text, Title, useTheme } from '@kavicki/swi-design-system'

export function NotFound() {
  const theme = useTheme()
  const navigate = useNavigate()
  return (
    <View testID="not-found" style={{ alignItems: 'flex-start', gap: theme.gap.m }}>
      <Title variant="title.m" color={theme.content.dark}>
        404
      </Title>
      <Text variant="body.m" color={theme.content.dark}>
        Tela não encontrada.
      </Text>
      <Button label="Voltar" variant="outline" onPress={() => navigate('/')} />
    </View>
  )
}
