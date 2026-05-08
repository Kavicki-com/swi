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

  it('shows the user full name in the header', async () => {
    renderTree()
    await waitFor(() => {
      expect(screen.getByText(/Admin Seed/)).toBeInTheDocument()
    })
  })

  it('renders all 9 navigation entries', async () => {
    renderTree()
    await waitFor(() => {
      expect(screen.getByTestId('page-content')).toBeInTheDocument()
    })
    const labels = [
      'Dashboard',
      'Mapas',
      'Alertas',
      'Funcionários',
      'Admins',
      'Monitoramento',
      'Relatórios',
      'Chat',
      'Configurações',
    ]
    for (const label of labels) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('signs out and clears the user from the header', async () => {
    renderTree()
    await waitFor(() => {
      expect(screen.getByTestId('page-content')).toBeInTheDocument()
    })
    const signOutButton = screen.getByRole('button', { name: /sair/i })
    fireEvent.click(signOutButton)
    await waitFor(() => {
      expect(screen.queryByText(/Admin Seed/)).not.toBeInTheDocument()
    })
  })
})
