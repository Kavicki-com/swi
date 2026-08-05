// src/pages/user/components/PermissionsSection.tsx
// Coluna "Permissões". Extraída de UserSettings.tsx.
//
// Sem prop nenhuma de propósito: os quatro toggles nunca foram lidos fora
// deles mesmos e não entram no PUT do perfil, então o estado desce junto com o
// componente. A seção é renderizada incondicionalmente, então o ciclo de vida
// do estado é o mesmo que era na página.
import { useState } from 'react'
import { View } from 'react-native'
import { Text, Title, Toggle, useTheme } from '@kavicki/swi-design-system'

export function PermissionsSection() {
  const theme = useTheme()
  const [permNotifications, setPermNotifications] = useState(true)
  const [permLocation, setPermLocation] = useState(false)
  const [permFiles, setPermFiles] = useState(true)
  const [permCalls, setPermCalls] = useState(true)
  return (
    <View style={{ width: 224, gap: theme.gap.m }}>
      <Title variant="title.xs" color={theme.content.primary}>
        Permissões
      </Title>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
        <Toggle value={permNotifications} onChange={setPermNotifications} />
        <Text variant="body.m" color={theme.content.dark}>
          Notificações
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
        <Toggle value={permLocation} onChange={setPermLocation} />
        <Text variant="body.m" color={theme.content.dark}>
          Localização
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
        <Toggle value={permFiles} onChange={setPermFiles} />
        <Text variant="body.m" color={theme.content.dark}>
          Acessar pastas e arquivos
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
        <Toggle value={permCalls} onChange={setPermCalls} />
        <Text variant="body.m" color={theme.content.dark}>
          Ligações telefônicas
        </Text>
      </View>
    </View>
  )
}
