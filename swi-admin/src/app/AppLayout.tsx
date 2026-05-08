import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { View } from 'react-native'
import { Button, Logo, SideMenu, Text, useTheme } from '@kavicki/swi-design-system'
import { useAuth } from '@/hooks/useAuth'

const NAV = [
  { value: '/', label: 'Dashboard' },
  { value: '/maps/general', label: 'Mapas' },
  { value: '/alerts', label: 'Alertas' },
  { value: '/employees', label: 'Funcionários' },
  { value: '/admins', label: 'Admins' },
  { value: '/monitoring/alerts', label: 'Monitoramento' },
  { value: '/reports', label: 'Relatórios' },
  { value: '/chat', label: 'Chat' },
  { value: '/user/settings', label: 'Configurações' },
] as const

export function AppLayout() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const theme = useTheme()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <View
      testID="app-layout"
      style={{ flexDirection: 'row', minHeight: '100vh' as unknown as number }}
    >
      <SideMenu
        items={[...NAV]}
        value={location.pathname}
        onChange={(value: string) => navigate(value)}
      />
      <View style={{ flex: 1 }}>
        <View
          testID="app-header"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: theme.padding.m,
            borderBottomWidth: theme.border.size.s,
            borderBottomColor: theme.content.lightGrey,
          }}
        >
          <Logo />
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.gap.m,
            }}
          >
            <Text>{user?.full_name ?? ''}</Text>
            <Button label="Sair" variant="outline" onPress={handleSignOut} />
          </View>
        </View>
        <View style={{ flex: 1, padding: 24 }}>
          <Outlet />
        </View>
      </View>
    </View>
  )
}
