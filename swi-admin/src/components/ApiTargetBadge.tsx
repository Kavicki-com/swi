import { View } from 'react-native'
import { Icon, Text, useTheme } from '@kavicki/swi-design-system'
import { describeApiTarget, getApiUrl } from '@/services/api/apiConfig'

// Selo discreto do backend que ESTE painel está lendo.
//
// O aplicativo do trabalhador fala com a API pública; o painel, quando sobe
// pelo pacote de duplo clique, fala com o backend local que o próprio pacote
// levanta. São dois ambientes separados de propósito, e quem olha os dois lados
// sem saber disso conclui que o sistema está quebrado, porque um não mostra o
// dado do outro. O selo põe essa resposta na tela.
//
// Composição DS (Icon + Text), mesmo padrão do SimulatedDataBadge. O glifo é
// `info` porque o design system não tem ícone de ambiente ou servidor, e um
// selo informativo não justifica um bump só por isso.
export function ApiTargetBadge() {
  const theme = useTheme()
  const alvo = describeApiTarget(getApiUrl())
  return (
    <View
      testID="api-target-badge"
      accessibilityLabel={`Dados vindos de ${alvo.label}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.xs }}
    >
      <Icon name="info" size={14} color={theme.content.medium} />
      <Text variant="body.s" color={theme.content.medium}>
        {alvo.label}
      </Text>
    </View>
  )
}
