import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AuthProvider } from '@/hooks/useAuth'
import { RequireAuth } from './RequireAuth'
import { GuestOnly } from './GuestOnly'

const Protected = () => <div data-testid="protected" />
const Guest = () => <div data-testid="guest" />
const LoginStub = () => <div data-testid="login-stub" />
const HomeStub = () => <div data-testid="home-stub" />

const renderTree = (initialEntries: string[]) =>
  render(
    <SwiThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path="/login" element={<LoginStub />} />
            <Route element={<RequireAuth />}>
              <Route path="/" element={<HomeStub />} />
              <Route path="/protected" element={<Protected />} />
            </Route>
            <Route element={<GuestOnly />}>
              <Route path="/guest" element={<Guest />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </SwiThemeProvider>,
  )

describe('RequireAuth', () => {
  beforeEach(() => window.localStorage.clear())

  it('redirects unauthenticated user from / to /login', async () => {
    renderTree(['/'])
    await waitFor(() => {
      expect(screen.getByTestId('login-stub')).toBeInTheDocument()
    })
  })

  it('renders protected content when authenticated (session in localStorage)', async () => {
    window.localStorage.setItem(
      'swi.admin.session',
      JSON.stringify({
        id: 'u_seed_1',
        org_id: 'org_seed_1',
        email: 'a',
        full_name: 'a',
        role: 'admin',
        consent_given_at: null,
        created_at: '',
      }),
    )
    renderTree(['/protected'])
    await waitFor(() => {
      expect(screen.getByTestId('protected')).toBeInTheDocument()
    })
  })
})

describe('GuestOnly', () => {
  beforeEach(() => window.localStorage.clear())

  it('lets guests in', async () => {
    renderTree(['/guest'])
    await waitFor(() => {
      expect(screen.getByTestId('guest')).toBeInTheDocument()
    })
  })

  it('redirects authenticated to /', async () => {
    window.localStorage.setItem(
      'swi.admin.session',
      JSON.stringify({
        id: 'u_seed_1',
        org_id: 'org_seed_1',
        email: 'a',
        full_name: 'a',
        role: 'admin',
        consent_given_at: null,
        created_at: '',
      }),
    )
    renderTree(['/guest'])
    await waitFor(() => {
      expect(screen.getByTestId('home-stub')).toBeInTheDocument()
    })
  })
})
