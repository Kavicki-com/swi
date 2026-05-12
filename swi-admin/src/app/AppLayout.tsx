import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Pressable, View } from 'react-native'
import {
  Button,
  ChatSection,
  HeaderUserInfo,
  Icon,
  Logo,
  Text,
  useTheme,
} from '@kavicki/swi-design-system'
import { useAuth } from '@/hooks/useAuth'
import workerA from '@/assets/avatars/worker-a.png'
import workerB from '@/assets/avatars/worker-b.png'
import workerC from '@/assets/avatars/worker-c.png'

// DS module is shimmed to `any`; mirror the types we need locally.
type IconName = string
type ChatSectionUser = {
  id: string
  name: string
  subtitle?: string
  avatarUri?: string
  unreadCount?: number
}
type NavItem = { value: string; label: string; icon: IconName }

const NAV: ReadonlyArray<NavItem> = [
  { value: '/', label: 'Home', icon: 'home' },
  { value: '/admins', label: 'Administradores', icon: 'manage_accounts' },
  { value: '/employees', label: 'Funcionários', icon: 'person_apron' },
  { value: '/monitoring/alerts', label: 'Monitoramento', icon: 'monitor_heart' },
  { value: '/reports', label: 'Relatórios', icon: 'monitoring' },
  { value: '/alerts', label: 'Alertas', icon: 'notifications' },
  { value: '/user/settings', label: 'Configurações', icon: 'settings' },
]

// Sidebar chat list — Figma frame 4:2 mocks 4 contacts. Real chat ships in S5.
// Avatars are real worker photos exported from the same Figma frame.
const CHAT_USERS: ChatSectionUser[] = [
  {
    id: 'chat_ezequiel',
    name: 'Ezequiel Almeida',
    subtitle: 'Setor Leste',
    avatarUri: workerA,
    unreadCount: 2,
  },
  { id: 'chat_romulo', name: 'Romulo Cardoso', subtitle: 'Setor Norte', avatarUri: workerB },
  {
    id: 'chat_julio',
    name: 'Júlio Lacerda',
    subtitle: 'Setor Sul',
    avatarUri: workerC,
    unreadCount: 1,
  },
  { id: 'chat_jennifer', name: 'Jennifer Gomes', subtitle: 'Setor Oeste', avatarUri: workerA },
]

function NavCard({
  item,
  active,
  onPress,
}: {
  item: NavItem
  active: boolean
  onPress: () => void
}) {
  const theme = useTheme()
  const accent = active ? theme.content.primary : theme.content.dark
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="menuitem"
      accessibilityState={{ selected: active }}
      testID={`nav-${item.value === '/' ? 'home' : item.value.replace(/\//g, '-').replace(/^-/, '')}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.gap.sm,
        paddingHorizontal: theme.padding.m,
        paddingVertical: theme.padding.sm,
        borderRadius: theme.border.radius.m,
        backgroundColor: theme.surface.standard,
        position: 'relative' as unknown as never,
      }}
    >
      <Icon name={item.icon} size={24} color={accent} />
      <Text
        style={{
          color: accent,
          fontSize: 13,
          fontWeight: '700' as const,
          textTransform: 'uppercase' as unknown as never,
          letterSpacing: 0.8,
        }}
      >
        {item.label}
      </Text>
      {active && (
        <View
          style={{
            position: 'absolute' as unknown as never,
            right: 0,
            top: theme.padding.s,
            bottom: theme.padding.s,
            width: 3,
            backgroundColor: theme.content.primary,
            borderRadius: theme.border.radius.s,
          }}
        />
      )}
    </Pressable>
  )
}

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
      style={{
        flexDirection: 'row',
        minHeight: '100vh' as unknown as number,
      }}
    >
      <View
        testID="app-sidebar"
        style={{
          width: 240,
          flexDirection: 'column',
          backgroundColor: theme.background,
          paddingHorizontal: theme.padding.s,
          paddingVertical: theme.padding.m,
          gap: theme.gap.s,
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
        <View
          testID="app-sidebar-nav"
          accessibilityLabel="Navegação principal"
          style={{ gap: theme.gap.s }}
        >
          {NAV.map((item) => (
            <NavCard
              key={item.value}
              item={item}
              active={location.pathname === item.value}
              onPress={() => navigate(item.value)}
            />
          ))}
        </View>
        <View testID="app-sidebar-chat" style={{ flex: 1, marginTop: theme.gap.m }}>
          <ChatSection
            users={CHAT_USERS}
            searchPlaceholder="Pesquisar Contatos"
            expandLabel="Esperando chat"
            fullWidth
          />
        </View>
        <View>
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
