// src/pages/user/components/PermissionsSection.tsx
// Coluna "Permissões". Extraída de UserSettings.tsx.
//
// "Notificações" liga os avisos do navegador para alerta urgente: ligar pede a
// permissão ao navegador dentro do clique, e a escolha fica guardada nele. Os
// outros três toggles nunca foram lidos fora deles mesmos e não entram no PUT
// do perfil, então o estado deles desce junto com o componente.
import { useState } from 'react'
import { View } from 'react-native'
import { Text, Title, Toggle, useTheme } from '@kavicki/swi-design-system'
import { useBrowserNotices } from '@/hooks/useBrowserNotices'
import {
  BROWSER_NOTICE_BLOCKED,
  BROWSER_NOTICE_UNSUPPORTED,
} from '@/services/browserNotifications/browserNotifications'

export function PermissionsSection() {
  const theme = useTheme()
  const notices = useBrowserNotices()
  const noticesBlocked = notices.support === 'denied' || notices.support === 'unsupported'
  const [permLocation, setPermLocation] = useState(false)
  const [permFiles, setPermFiles] = useState(true)
  const [permCalls, setPermCalls] = useState(true)
  return (
    <View style={{ width: 224, gap: theme.gap.m }}>
      <Title variant="title.xs" color={theme.content.primary}>
        Permissões
      </Title>
      <View style={{ gap: theme.gap.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
          <Toggle
            value={notices.enabled}
            onChange={(on) => (on ? void notices.request() : notices.disable())}
            disabled={noticesBlocked}
            accessibilityLabel="Notificações"
          />
          <Text variant="body.m" color={theme.content.dark}>
            Notificações
          </Text>
        </View>
        {noticesBlocked ? (
          <Text variant="body.s" color={theme.content.medium}>
            {notices.support === 'denied' ? BROWSER_NOTICE_BLOCKED : BROWSER_NOTICE_UNSUPPORTED}
          </Text>
        ) : null}
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
