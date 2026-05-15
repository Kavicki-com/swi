import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AuthProvider } from '@/hooks/useAuth'
import { AppLayout } from './AppLayout'

beforeEach(() => {
  window.localStorage.setItem(
    'swi.admin.session',
    JSON.stringify({
      id: 'u_seed_1',
      org_id: 'org_seed_1',
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

const renderTree = () =>
  render(
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
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </SwiThemeProvider>,
  )

describe('AppLayout', () => {
  it('renders outlet content for authenticated user', async () => {
    renderTree()
    await waitFor(() => {
      expect(screen.getByTestId('page-content')).toBeInTheDocument()
    })
  })

  it('shows the user vitals in HeaderUserInfo', async () => {
    renderTree()
    await waitFor(() => {
      expect(screen.getByTestId('app-header-user-info')).toBeInTheDocument()
      expect(screen.getByText(/78/)).toBeInTheDocument()
      expect(screen.getByText('12/8')).toBeInTheDocument()
    })
  })

  it('renders Logo at the top of the sidebar (not in the header)', async () => {
    renderTree()
    await waitFor(() => {
      expect(screen.getByTestId('app-sidebar-logo')).toBeInTheDocument()
    })
  })

  it('renders the 7 Figma navigation cards in order with icons', async () => {
    renderTree()
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
    ]
    for (const label of labels) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByTestId('app-sidebar-nav')).toBeInTheDocument()
  })

  it('navigates to /user/profile when the header user-info widget is pressed', async () => {
    renderTree()
    await waitFor(() => {
      expect(screen.getByTestId('app-header-user-info-pressable')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('app-header-user-info-pressable'))
    await waitFor(() => {
      expect(screen.getByTestId('profile-content')).toBeInTheDocument()
    })
  })

  it('renders the ChatSection with mocked contacts in the sidebar', async () => {
    renderTree()
    await waitFor(() => {
      expect(screen.getByTestId('app-sidebar-chat')).toBeInTheDocument()
    })
    expect(screen.getByText('Ezequiel Almeida')).toBeInTheDocument()
    expect(screen.getByText('Romulo Cardoso')).toBeInTheDocument()
    expect(screen.getByText('Júlio Lacerda')).toBeInTheDocument()
    expect(screen.getByText('Jennifer Gomes')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Pesquisar Contatos')).toBeInTheDocument()
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
      window.dispatchEvent(new Event('resize'))
    }

    afterEach(() => {
      // Restore the desktop default for the remaining test files.
      setViewportWidth(1366)
    })

    it('renders the tablet top-bar (no sidebar) when width < 1024', async () => {
      setViewportWidth(800)
      renderTree()
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

    it('renders the desktop sidebar when 1024 ≤ width < 1600', async () => {
      setViewportWidth(1366)
      renderTree()
      await waitFor(() => {
        expect(screen.getByTestId('app-sidebar')).toBeInTheDocument()
      })
      expect(screen.queryByTestId('app-topbar')).not.toBeInTheDocument()
      expect(screen.queryByTestId('app-layout-tablet')).not.toBeInTheDocument()
    })

    it('renders the desktop sidebar (no top-bar) when width >= 1600 (wide)', async () => {
      setViewportWidth(1920)
      renderTree()
      await waitFor(() => {
        expect(screen.getByTestId('app-sidebar')).toBeInTheDocument()
      })
      expect(screen.queryByTestId('app-topbar')).not.toBeInTheDocument()
      expect(screen.queryByTestId('app-layout-tablet')).not.toBeInTheDocument()
    })
  })
})
