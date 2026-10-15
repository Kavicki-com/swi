// src/pages/user/components/PermissionsSection.tsx
// Coluna "Permissões". Extraída de UserSettings.tsx.
//
// Mostra o nível de quem está logado e o que ele pode fazer, como o backend
// calcula (GET /auth/me): o painel não guarda cópia da matriz de acesso.
//
// "Notificações" liga os avisos do navegador para alerta urgente: ligar pede a
// permissão ao navegador dentro do clique, e a escolha fica guardada nele. Os
// antigos toggles de Localização, Arquivos e Ligações saíram: não salvavam em
// lugar nenhum e o perfil não tem onde guardá-los.
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Text, Title, Toggle, useTheme } from '@kavicki/swi-design-system'
import { levelLabel, permissionLabel } from '@/app/levels'
import { useBrowserNotices } from '@/hooks/useBrowserNotices'
import { authApi } from '@/services/auth'
import type { MyAccess } from '@/services/api/auth'
import {
  BROWSER_NOTICE_BLOCKED,
  BROWSER_NOTICE_UNSUPPORTED,
} from '@/services/browserNotifications/browserNotifications'

type AccessState = { status: 'loading' } | { status: 'error' } | { status: 'ok'; access: MyAccess }

export function PermissionsSection() {
  const theme = useTheme()
  const notices = useBrowserNotices()
  const noticesBlocked = notices.support === 'denied' || notices.support === 'unsupported'
  const [access, setAccess] = useState<AccessState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    void authApi.me().then(({ data }) => {
      if (!cancelled) setAccess(data ? { status: 'ok', access: data } : { status: 'error' })
    })
    return () => {
      cancelled = true
    }
  }, [])

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
      {access.status === 'error' ? (
        <Text variant="body.s" color={theme.content.medium}>
          Não foi possível carregar suas permissões.
        </Text>
      ) : null}
      {access.status === 'ok' ? (
        <View testID="permissions-access" style={{ gap: theme.gap.xs }}>
          <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '700' }}>
            Nível: {levelLabel(access.access.role)}
          </Text>
          {access.access.permissions.map((permission) => (
            <Text key={permission} variant="body.s" color={theme.content.dark}>
              {permissionLabel(permission)}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  )
}
