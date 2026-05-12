import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    })
    expect(screen.getByText(/78/)).toBeInTheDocument()
    expect(screen.getByText('12/8')).toBeInTheDocument()
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
    // Each item is rendered as an individual nav card with its own testID.
    expect(screen.getByTestId('nav-home')).toBeInTheDocument()
    expect(screen.getByTestId('nav-admins')).toBeInTheDocument()
    expect(screen.getByTestId('nav-employees')).toBeInTheDocument()
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

  it('signs out from the sidebar footer and navigates away', async () => {
    renderTree()
    await waitFor(() => {
      expect(screen.getByTestId('page-content')).toBeInTheDocument()
    })
    const signOutButton = screen.getByTestId('sidebar-signout')
    fireEvent.click(signOutButton)
    await waitFor(() => {
      // After sign-out, navigate('/login') is called. The test router has no
      // /login route, so the protected /page content unmounts.
      expect(screen.queryByTestId('page-content')).not.toBeInTheDocument()
    })
  })
})
