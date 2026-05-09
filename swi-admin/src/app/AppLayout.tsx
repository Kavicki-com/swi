import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { View } from 'react-native'
import {
  Button,
  ChatSection,
  HeaderUserInfo,
  Logo,
  SideMenu,
  useTheme,
} from '@kavicki/swi-design-system'
import { useAuth } from '@/hooks/useAuth'

// DS module is shimmed to `any`; mirror the ChatSectionUser shape locally.
type ChatSectionUser = {
  id: string
  name: string
  subtitle?: string
  avatarUri?: string
  unreadCount?: number
}

const NAV = [
  { value: '/', label: 'Home' },
  { value: '/maps/general', label: 'Mapas' },
  { value: '/alerts', label: 'Alertas' },
  { value: '/employees', label: 'Funcionários' },
  { value: '/admins', label: 'Admins' },
  { value: '/monitoring/alerts', label: 'Monitoramento' },
  { value: '/reports', label: 'Relatórios' },
  { value: '/chat', label: 'Chat' },
  { value: '/user/settings', label: 'Configurações' },
] as const

// Sidebar chat list — Figma frame 4:2 mocks 4 contacts. Real chat ships in S5.
const CHAT_USERS: ChatSectionUser[] = [
  { id: 'chat_ezequiel', name: 'Ezequiel Almeida', subtitle: 'Setor Leste', unreadCount: 2 },
  { id: 'chat_romulo', name: 'Romulo Cardoso', subtitle: 'Setor Norte' },
  { id: 'chat_julio', name: 'Júlio Lacerda', subtitle: 'Setor Sul', unreadCount: 1 },
  { id: 'chat_jennifer', name: 'Jennifer Gomes', subtitle: 'Setor Oeste' },
]

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
      <View
        testID="app-sidebar"
        style={{
          width: 240,
          flexDirection: 'column',
          backgroundColor: theme.background,
        }}
      >
        <View
          testID="app-sidebar-logo"
          style={{
            paddingHorizontal: theme.padding.m,
            paddingVertical: theme.padding.l,
          }}
        >
          <Logo type="complete" size="m" />
        </View>
        <SideMenu
          testID="app-sidebar-nav"
          variant="compact"
          items={[...NAV]}
          value={location.pathname}
          onChange={(value: string) => navigate(value)}
        />
        <View testID="app-sidebar-chat" style={{ flex: 1, paddingHorizontal: theme.padding.s }}>
          <ChatSection
            users={CHAT_USERS}
            searchPlaceholder="Pesquisar Contatos"
            expandLabel="Esperando chat"
            fullWidth
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
        <View
          testID="app-header"
          style={{
            flexDirection: 'row',
            justifyContent: 'flex-end',
            paddingHorizontal: theme.padding.l,
            paddingVertical: theme.padding.m,
          }}
        >
          <HeaderUserInfo
            bpm={user?.bpm ?? 78}
            pressure={user?.pressure ?? '12/8'}
            avatarUri={user?.avatarUri}
            testID="app-header-user-info"
          />
        </View>
        <View style={{ flex: 1, padding: 24 }}>
          <Outlet />
        </View>
      </View>
    </View>
  )
}
