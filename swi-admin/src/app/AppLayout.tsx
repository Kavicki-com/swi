import { useEffect, useState, type ReactNode } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Pressable, View } from 'react-native'
import { flushSync } from 'react-dom'

// Wrap a navigation in the View Transitions API so cards with matching
// `viewTransitionName` morph across the route change. Falls back to a plain
// navigate on browsers without `document.startViewTransition` (Firefox < 130,
// older Safari).
function navigateWithTransition(navigate: (to: string) => void, to: string) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  if (typeof doc.startViewTransition === 'function') {
    doc.startViewTransition(() => {
      flushSync(() => navigate(to))
    })
  } else {
    navigate(to)
  }
}
import {
  Button,
  ChatSection,
  HeaderUserInfo,
  Logo,
  SideMenu,
  useTheme,
} from '@kavicki/swi-design-system'
import { useAuth } from '@/hooks/useAuth'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { NAV_ITEMS } from '@/app/nav'
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

// Sidebar chat list — Figma frame 4:2 mocks 4 contacts. Real chat ships in S5.
// Avatars are real worker photos exported from the same Figma frame.
// IDs match the chat-* prefix used by mockApi/chats.ts so a click in the
// sidebar can deep-link straight into /chat/:contactId without translation.
const CHAT_USERS: ChatSectionUser[] = [
  {
    id: 'chat-ezequiel',
    name: 'Ezequiel Almeida',
    subtitle: 'Setor Leste',
    avatarUri: chatEzequiel,
    unreadCount: 2,
  },
  { id: 'chat-romulo', name: 'Romulo Cardoso', subtitle: 'Setor Norte', avatarUri: chatRomulo },
  {
    id: 'chat-josue',
    name: 'Júlio Lacerda',
    subtitle: 'Setor Sul',
    avatarUri: chatJulio,
    unreadCount: 1,
  },
  { id: 'chat-jennifer', name: 'Jennifer Gomes', subtitle: 'Setor Oeste', avatarUri: chatJennifer },
]

/**
 * Resolve which sidebar item should be highlighted for a given pathname.
 * Plain `value === pathname` doesn't work for nested routes like
 * `/admins/admin-01` — we want the parent section (`/admins`) to stay
 * active. So we prefix-match against each NAV item:
 *   - "/" only matches when pathname is exactly "/"
 *   - everything else matches when pathname === value OR
 *     pathname starts with `${value}/`
 * Falls back to the raw pathname when nothing matches, so the SideMenu
 * simply renders nothing as active.
 */
function resolveActiveNavValue(pathname: string): string {
  // Any /monitoring/* sub-route keeps the "Monitoramento" sidebar item active.
  // Sidebar entry points to /monitoring/alerts (default); tabs inside the
  // monitoring screens switch between alerts/good-conditions/etc.
  if (pathname.startsWith('/monitoring/')) {
    return '/monitoring/alerts'
  }
  for (const item of NAV_ITEMS) {
    if (item.value === '/') {
      if (pathname === '/') return '/'
      continue
    }
    if (pathname === item.value || pathname.startsWith(`${item.value}/`)) {
      return item.value
    }
  }
  return pathname
}

export function AppLayout() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const theme = useTheme()
  const breakpoint = useBreakpoint()
  const activeNavValue = resolveActiveNavValue(location.pathname)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Close the drawer whenever the route changes — clicking a nav item should
  // both navigate and dismiss the overlay without extra plumbing.
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  const headerUserInfo = (
    <Pressable
      onPress={() => navigate('/user/profile')}
      accessibilityRole="button"
      accessibilityLabel="Abrir perfil do usuário"
      testID="app-header-user-info-pressable"
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
    </Pressable>
  )

  if (breakpoint === 'tablet') {
    return (
      <View
        testID="app-layout-tablet"
        style={{
          flexDirection: 'column',
          minHeight: '100vh' as unknown as number,
        }}
      >
        <View
          testID="app-topbar"
          dataSet={{ fidelity: 'topbar' }}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: theme.padding.l,
            paddingVertical: theme.padding.m,
            backgroundColor: theme.background,
            gap: theme.gap.m,
          }}
        >
          <Pressable
            onPress={() => navigate('/')}
            accessibilityRole="link"
            accessibilityLabel="Ir para dashboard"
          >
            <Logo type="complete" size="m" />
          </Pressable>
          {/* DS Button supports label-only; the DS doesn't ship a hamburger
              glyph today, so we use the Portuguese label "Menu" rather than
              spinning up a custom icon (project rule: no local components,
              no DS edits in Sprint 1). A future DS bump can swap to iconLeft
              once a menu glyph lands. */}
          <Button
            label="Menu"
            variant="outline"
            size="small"
            onPress={() => setDrawerOpen((v) => !v)}
            accessibilityLabel="Abrir menu de navegação"
            testID="app-topbar-hamburger"
          />
          {headerUserInfo}
        </View>
        <View style={{ flex: 1, paddingHorizontal: 24, paddingVertical: 24 }}>
          <Outlet />
        </View>
        {drawerOpen && (
          <View
            testID="app-drawer"
            dataSet={{ fidelity: 'drawer' }}
            // Overlay panel: dim the page and dock the menu panel on the
            // left. Width 280 keeps Figma proportions for tablet portrait.
            style={{
              position: 'absolute' as unknown as never,
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              flexDirection: 'row',
            }}
          >
            <View
              testID="app-drawer-panel"
              style={{
                width: 280,
                backgroundColor: theme.background,
                paddingHorizontal: theme.padding.s,
                paddingVertical: theme.padding.m,
                gap: theme.gap.m,
              }}
            >
              <View
                style={{
                  paddingHorizontal: theme.padding.s,
                  paddingVertical: theme.padding.m,
                }}
              >
                <Pressable
                  onPress={() => navigate('/')}
                  accessibilityRole="link"
                  accessibilityLabel="Ir para dashboard"
                >
                  <Logo type="complete" size="m" />
                </Pressable>
              </View>
              <SideMenu
                testID="app-drawer-nav"
                accessibilityLabel="Navegação principal"
                items={NAV_ITEMS}
                value={activeNavValue}
                onChange={(v: string) => navigate(v)}
                fullWidth
              />
              <View testID="app-drawer-chat">
                <ChatSection
                  users={CHAT_USERS}
                  searchPlaceholder="Pesquisar Contatos"
                  expandLabel="Expandir chat"
                  onUserPress={(id: string) => navigateWithTransition(navigate, `/chat/${id}`)}
                  onExpand={() => navigateWithTransition(navigate, '/chat')}
                  fullWidth
                  // @ts-expect-error renderCard is in local DS source; node_modules pin v0.1.35 doesn't have it yet.
                  renderCard={(card: ReactNode, user: ChatSectionUser) => (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        width: '100%',
                        viewTransitionName: `chat-card-${user.id}`,
                      }}
                    >
                      {card}
                    </div>
                  )}
                />
              </View>
            </View>
            <Pressable
              testID="app-drawer-scrim"
              accessibilityRole="button"
              accessibilityLabel="Fechar menu de navegação"
              onPress={() => setDrawerOpen(false)}
              style={{
                flex: 1,
                backgroundColor: 'rgba(0,0,0,0.45)',
              }}
            />
          </View>
        )}
      </View>
    )
  }

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
          gap: theme.gap.s,
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
          <Pressable
            onPress={() => navigate('/')}
            accessibilityRole="link"
            accessibilityLabel="Ir para dashboard"
          >
            <Logo type="complete" size="m" />
          </Pressable>
        </View>
        <SideMenu
          testID="app-sidebar-nav"
          accessibilityLabel="Navegação principal"
          items={NAV_ITEMS}
          value={activeNavValue}
          onChange={(v: string) => navigate(v)}
          fullWidth
        />
        <View testID="app-sidebar-chat" style={{ marginTop: theme.gap.s }}>
          <ChatSection
            users={CHAT_USERS}
            searchPlaceholder="Pesquisar Contatos"
            expandLabel="Expandir chat"
            onUserPress={(id: string) => navigateWithTransition(navigate, `/chat/${id}`)}
            onExpand={() => navigateWithTransition(navigate, '/chat')}
            fullWidth
            // @ts-expect-error renderCard is in local DS source; node_modules pin v0.1.35 doesn't have it yet.
            renderCard={(card: ReactNode, user: ChatSectionUser) => (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  width: '100%',
                  viewTransitionName: `chat-card-${user.id}`,
                }}
              >
                {card}
              </div>
            )}
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
          {headerUserInfo}
        </View>
        <View style={{ flex: 1, padding: 24 }}>
          <Outlet />
        </View>
      </View>
    </View>
  )
}
