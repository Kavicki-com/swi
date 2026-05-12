import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { View } from 'react-native'
import { ChatSection, HeaderUserInfo, Logo, SideMenu, useTheme } from '@kavicki/swi-design-system'
import { useAuth } from '@/hooks/useAuth'
import workerA from '@/assets/avatars/worker-a.png'
import chatEzequiel from '@/assets/avatars/chat-ezequiel.png'
import chatRomulo from '@/assets/avatars/chat-romulo.png'
import chatJulio from '@/assets/avatars/chat-julio.png'
import chatJennifer from '@/assets/avatars/chat-jennifer.png'

// DS module is shimmed to `any`; mirror the types we need locally.
type ChatSectionUser = {
  id: string
  name: string
  subtitle?: string
  avatarUri?: string
  unreadCount?: number
}
type NavItem = { value: string; label: string; icon: string }

const NAV: ReadonlyArray<NavItem> = [
  { value: '/', label: 'Home', icon: 'home_filled' },
  { value: '/admins', label: 'Administradores', icon: 'admin_filled' },
  { value: '/employees', label: 'Funcionários', icon: 'worker_filled' },
  { value: '/monitoring/alerts', label: 'Monitoramento', icon: 'monitor_filled' },
  { value: '/reports', label: 'Relatórios', icon: 'reports_filled' },
  { value: '/alerts', label: 'Alertas', icon: 'bell_filled' },
  { value: '/user/settings', label: 'Configurações', icon: 'settings_filled' },
]

// Sidebar chat list — Figma frame 4:2 mocks 4 contacts. Real chat ships in S5.
// Avatars are real worker photos exported from the same Figma frame.
const CHAT_USERS: ChatSectionUser[] = [
  {
    id: 'chat_ezequiel',
    name: 'Ezequiel Almeida',
    subtitle: 'Setor Leste',
    avatarUri: chatEzequiel,
    unreadCount: 2,
  },
  { id: 'chat_romulo', name: 'Romulo Cardoso', subtitle: 'Setor Norte', avatarUri: chatRomulo },
  {
    id: 'chat_julio',
    name: 'Júlio Lacerda',
    subtitle: 'Setor Sul',
    avatarUri: chatJulio,
    unreadCount: 1,
  },
  { id: 'chat_jennifer', name: 'Jennifer Gomes', subtitle: 'Setor Oeste', avatarUri: chatJennifer },
]

export function AppLayout() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const theme = useTheme()

  return (
    <View
      testID="app-layout"
      style={{
        flexDirection: 'row',
        minHeight: '100vh' as unknown as number,
        // Figma frame 4:2 layout: 40px left margin + 228 sidebar + 16 gap +
        // 1041 content + 41 right margin = 1366. Body gradient shows through
        // the outer paddings.
        paddingLeft: 40,
        paddingRight: 41,
        gap: 16,
      }}
    >
      <View
        testID="app-sidebar"
        dataSet={{ fidelity: 'sidebar' }}
        style={{
          width: 228,
          flexDirection: 'column',
          backgroundColor: theme.background,
          paddingHorizontal: theme.padding.s,
          paddingVertical: theme.padding.m,
          // Figma sidebar itemSpacing = 16; theme.gap.m maps to that scale step.
          gap: theme.gap.m,
          // Sidebar sizes to its content height (Figma: 865px) so the page
          // bg-overlay is visible below it instead of being masked by
          // theme.background extending to the full viewport row height.
          alignSelf: 'flex-start',
        }}
      >
        <View
          testID="app-sidebar-logo"
          style={{
            paddingHorizontal: theme.padding.s,
            paddingVertical: theme.padding.m,
          }}
        >
          <Logo type="complete" size="m" />
        </View>
        <SideMenu
          testID="app-sidebar-nav"
          accessibilityLabel="Navegação principal"
          items={NAV}
          value={location.pathname}
          onChange={(v: string) => navigate(v)}
          fullWidth
        />
        <View testID="app-sidebar-chat">
          <ChatSection
            users={CHAT_USERS}
            searchPlaceholder="Pesquisar Contatos"
            expandLabel="Esperando chat"
            fullWidth
          />
        </View>
      </View>
      <View style={{ flex: 1 }}>
        <View
          testID="app-header"
          dataSet={{ fidelity: 'header' }}
          style={{
            flexDirection: 'row',
            justifyContent: 'flex-end',
            paddingHorizontal: theme.padding.l,
            paddingVertical: theme.padding.m,
          }}
        >
          <HeaderUserInfo
            bpm={user?.bpm ?? 99}
            pressure={user?.pressure ?? '12/8'}
            progress={50}
            avatarUri={user?.avatarUri ?? workerA}
            heartIconName="heart_filled"
            pressureIconName="vitals_pulse"
            borderColor={theme.background}
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
