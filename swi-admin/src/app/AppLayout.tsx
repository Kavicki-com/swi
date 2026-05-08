import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { View } from 'react-native'
import { Button, Header, SideMenu, useTheme } from '@kavicki/swi-design-system'
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
      <View testID="app-sidebar" style={{ flexDirection: 'column' }}>
        <View style={{ flex: 1 }}>
          <SideMenu
            items={[...NAV]}
            value={location.pathname}
            onChange={(value: string) => navigate(value)}
          />
        </View>
        <View style={{ padding: theme.padding.s }}>
          <Button
            label="Sair"
            variant="ghost"
            onPress={handleSignOut}
            testID="sidebar-signout"
            fullWidth
          />
        </View>
      </View>
      <View style={{ flex: 1 }}>
        <Header
          bpm={user?.bpm ?? 78}
          pressure={user?.pressure ?? '12/8'}
          avatarUri={user?.avatarUri}
        />
        <View style={{ flex: 1, padding: 24 }}>
          <Outlet />
        </View>
      </View>
    </View>
  )
}
