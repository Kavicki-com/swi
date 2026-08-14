import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AuthProvider } from '@/hooks/useAuth'
import { SESSION_STORAGE_KEY, TOKEN_STORAGE_KEY } from '@/services/api/http'
import { simulatedVitalsFor } from '@/services/vitals/simulatedVitals'

// AppLayout agora consome useChat() (ChatProvider). Este teste NÃO monta o
// provider real (isso é a task B5) — mocka useChat pra devolver um contexto
// fixo com uma conversa que tem contato resolvível e badge de não-lidas. Os
// helpers puros resolveContact/unreadFor rodam de verdade sobre a conversa.
vi.mock('@/services/chat/ChatProvider', () => ({
  useChat: () => ({
    myId: 'me',
    conversations: [
      {
        id: 'me#w1',
        participants: ['me', 'w1'],
        participantNames: ['Eu', 'Ezequiel Almeida'],
        participantSubtitles: ['', 'Setor Leste'],
        participantAvatars: ['', ''],
        lastMessageBody: 'oi',
        lastMessageAt: '2026-07-23T10:00:00Z',
        unreadBy: { me: 3 },
      },
      // Conversa sem não-lidas: unreadFor === 0 → `|| undefined` colapsa o
      // unreadCount, e o ChatUserCard não pinta badge (showBadge = count > 0).
      {
        id: 'me#w2',
        participants: ['me', 'w2'],
        participantNames: ['Eu', 'Silvana Sem Badge'],
        participantSubtitles: ['', 'Setor Oeste'],
        participantAvatars: ['', ''],
        lastMessageBody: 'ok',
        lastMessageAt: '2026-07-22T09:00:00Z',
        unreadBy: { me: 0 },
      },
    ],
  }),
}))

import { AppLayout, resolveActiveNavValue } from './AppLayout'
import { settled } from '@/test-utils/renderPage'

beforeEach(() => {
  // getSession real exige token + sessão.
  window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-test')
  window.localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({
      id: 'u_seed_1',
      email: 'admin@swi.test',
      full_name: 'Admin Seed',
      role: 'super_admin',
      consent_given_at: null,
      created_at: '',
      bpm: 78,
      pressure: '12/8',
      avatarUri: 'https://i.pravatar.cc/200?img=12',
    }),
  )
})

afterEach(() => window.localStorage.clear())

// Expõe o pathname CRU (com o `#` ainda percent-encodado como %23) pra travar
// a codificação da navegação do lado do AppLayout sem mockar useNavigate — o que
// quebraria o teste de navegação do header, que depende do navigate real.
function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location-pathname">{location.pathname}</div>
}

const renderTree = async () =>
  settled(render(
    <SwiThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={['/page']}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/page" element={<div data-testid="page-content">hello</div>} />
              <Route
                path="/user/profile"
                element={<div data-testid="profile-content">profile</div>}
              />
              <Route path="/chat/:conversationId" element={<LocationProbe />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </SwiThemeProvider>,
  ))

describe('AppLayout', () => {
  it('renders outlet content for authenticated user', async () => {
    await renderTree()
    await waitFor(() => {
      expect(screen.getByTestId('page-content')).toBeInTheDocument()
    })
  })

  // Os vitais do header saem do MESMO gerador das outras telas (useMyVitals).
  // Com um literal no header ("99 bpm", "12/8"), ele contradiria o detalhe do
  // próprio admin.
  it('mostra os vitais do usuário logado, derivados do gerador (não um literal)', async () => {
    await renderTree()
    const esperado = simulatedVitalsFor('u_seed_1', Date.now())
    await waitFor(() => {
      expect(screen.getByTestId('app-header-user-info')).toBeInTheDocument()
      expect(screen.getByText(String(esperado.bpm))).toBeInTheDocument()
      expect(screen.getByText(esperado.pressure)).toBeInTheDocument()
    })
  })

  it('renders Logo at the top of the sidebar (not in the header)', async () => {
    await renderTree()
    await waitFor(() => {
      expect(screen.getByTestId('app-sidebar-logo')).toBeInTheDocument()
    })
  })

  it('renders the 8 navigation cards in order with icons', async () => {
    await renderTree()
    await waitFor(() => {
      expect(screen.getByTestId('page-content')).toBeInTheDocument()
    })
    const labels = [
      'Home',
      'Administradores',
      'Funcionários',
      'Monitoramento',
      'Relatórios',
      'Alertas',
      'Configurações',
      'Tarefas',
    ]
    for (const label of labels) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByTestId('app-sidebar-nav')).toBeInTheDocument()
  })

  // O avatar do header abre o menu fullscreen com vídeo e vitais, em vez de
  // navegar direto. A página de perfil continua alcançável pelo avatar grande
  // DENTRO do menu.
  it('opens the fullscreen user menu when the header user-info widget is pressed', async () => {
    await renderTree()
    await waitFor(() => {
      expect(screen.getByTestId('app-header-user-info-pressable')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('app-header-user-info-pressable'))
    await waitFor(() => {
      expect(screen.getByLabelText('Detalhes do usuário')).toBeInTheDocument()
    })
  })

  it('navigates to /user/profile from the big avatar inside the user menu', async () => {
    await renderTree()
    await waitFor(() => {
      expect(screen.getByTestId('app-header-user-info-pressable')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('app-header-user-info-pressable'))
    await waitFor(() => {
      expect(screen.getByLabelText('Abrir perfil do usuário')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByLabelText('Abrir perfil do usuário'))
    await waitFor(() => {
      expect(screen.getByTestId('profile-content')).toBeInTheDocument()
    })
  })

  it('renders the ChatSection fed by the ChatProvider conversations', async () => {
    await renderTree()
    await waitFor(() => {
      expect(screen.getByTestId('app-sidebar-chat')).toBeInTheDocument()
    })
    // Nome do contato resolvido (o outro participante), não mais a lista hardcoded.
    expect(screen.getByText('Ezequiel Almeida')).toBeInTheDocument()
    // Badge de não-lidas: unreadBy.me === 3 → ChatUserCard pad pra "03".
    expect(screen.getByText('03')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Pesquisar Contatos')).toBeInTheDocument()
  })

  it('navega pro chat com o id da conversa percent-encodado (# → %23)', async () => {
    await renderTree()
    await waitFor(() => {
      expect(screen.getByTestId('app-sidebar-chat')).toBeInTheDocument()
    })
    // O card do ChatUserCard é um Pressable com accessibilityRole="button" e
    // accessibilityLabel = name → acessível como button pelo nome do contato.
    fireEvent.click(screen.getByRole('button', { name: 'Ezequiel Almeida' }))
    // A conversationId `me#w1` TEM que virar `/chat/me%23w1` — sem o
    // encodeURIComponent o `#` vira fragmento de URL e o react-router perde o id.
    await waitFor(() => {
      expect(screen.getByTestId('location-pathname')).toHaveTextContent('/chat/me%23w1')
    })
  })

  it('não pinta badge quando a conversa não tem não-lidas (0 → sem badge)', async () => {
    await renderTree()
    await waitFor(() => {
      expect(screen.getByText('Silvana Sem Badge')).toBeInTheDocument()
    })
    // unreadBy.me === 0 → unreadCount undefined → nenhum badge; o "00" que o
    // padStart geraria pra um count>0 de 1 dígito NÃO aparece.
    expect(screen.queryByText('00')).not.toBeInTheDocument()
  })

  // O item ativo da sidebar sai de resolveActiveNavValue. Testamos a função
  // direto porque o react-native-web não emite `aria-selected` pro
  // accessibilityState.selected do MenuItem (role="button"), então não há
  // marcador de ativo consultável no DOM.
  describe('resolveActiveNavValue', () => {
    it('marca Tarefas na rota exata e nas sub-rotas', () => {
      expect(resolveActiveNavValue('/tasks')).toBe('/tasks')
      expect(resolveActiveNavValue('/tasks/new')).toBe('/tasks')
      expect(resolveActiveNavValue('/tasks/abc')).toBe('/tasks')
      expect(resolveActiveNavValue('/tasks/abc/edit')).toBe('/tasks')
    })

    it('não deixa Tarefas vazar pra outras seções', () => {
      expect(resolveActiveNavValue('/alerts')).toBe('/alerts')
      expect(resolveActiveNavValue('/')).toBe('/')
    })
  })

  // Responsive system tests — one per breakpoint class.
  //
  // react-native-web's Dimensions polyfill reads
  // `document.documentElement.clientWidth` (see
  // node_modules/react-native-web/dist/cjs/exports/Dimensions/index.js).
  // The global test-setup pins it to 1366 (desktop) so the legacy tests
  // above render the sidebar. Here we override per-test by redefining the
  // getter, then fire a window 'resize' event so RN-Web's Dimensions
  // listener picks up the change before AppLayout mounts.
  //
  // Why not vi.mock('react-native', ...)? The DS internally consumes many
  // react-native exports during render; replacing the whole module would
  // break it. clientWidth is what RN-Web actually reads, so overriding the
  // getter is the lighter, equivalent hook.
  describe('breakpoints', () => {
    const setViewportWidth = (w: number) => {
      Object.defineProperty(document.documentElement, 'clientWidth', {
        configurable: true,
        get: () => w,
      })
      Object.defineProperty(document.documentElement, 'clientHeight', {
        configurable: true,
        get: () => 900,
      })
      // O listener de Dimensions do react-native-web reage a este evento
      // atualizando estado; fora de act o React acusa a atualização.
      act(() => {
        window.dispatchEvent(new Event('resize'))
      })
    }

    afterEach(() => {
      // Restore the desktop default for the remaining test files.
      setViewportWidth(1366)
    })

    it('renders the tablet top-bar (no sidebar) when width < 1024', async () => {
      setViewportWidth(800)
      await renderTree()
      await waitFor(() => {
        expect(screen.getByTestId('app-layout-tablet')).toBeInTheDocument()
      })
      expect(screen.getByTestId('app-topbar')).toBeInTheDocument()
      expect(screen.getByTestId('app-topbar-hamburger')).toBeInTheDocument()
      expect(screen.queryByTestId('app-sidebar')).not.toBeInTheDocument()
      // Drawer starts closed.
      expect(screen.queryByTestId('app-drawer')).not.toBeInTheDocument()
      // Hamburger opens it.
      fireEvent.click(screen.getByTestId('app-topbar-hamburger'))
      await waitFor(() => {
        expect(screen.getByTestId('app-drawer')).toBeInTheDocument()
      })
    })

    it('renders the desktop sidebar when 1024 ≤ width < 1500', async () => {
      setViewportWidth(1366)
      await renderTree()
      await waitFor(() => {
        expect(screen.getByTestId('app-sidebar')).toBeInTheDocument()
      })
      expect(screen.queryByTestId('app-topbar')).not.toBeInTheDocument()
      expect(screen.queryByTestId('app-layout-tablet')).not.toBeInTheDocument()
    })

    it('renders the desktop sidebar (no top-bar) when width >= 1500 (wide)', async () => {
      setViewportWidth(1920)
      await renderTree()
      await waitFor(() => {
        expect(screen.getByTestId('app-sidebar')).toBeInTheDocument()
      })
      expect(screen.queryByTestId('app-topbar')).not.toBeInTheDocument()
      expect(screen.queryByTestId('app-layout-tablet')).not.toBeInTheDocument()
    })
  })
})
