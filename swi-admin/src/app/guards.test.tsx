import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AuthProvider } from '@/hooks/useAuth'
import { clearSession, SESSION_STORAGE_KEY, TOKEN_STORAGE_KEY } from '@/services/api/http'
import { RequireAuth } from './RequireAuth'
import { GuestOnly } from './GuestOnly'

const Protected = () => <div data-testid="protected" />
const Guest = () => <div data-testid="guest" />
const LoginStub = () => <div data-testid="login-stub" />
const HomeStub = () => <div data-testid="home-stub" />

// Sessão autenticada como o getSession real exige: token + sessão.
const seedAuthed = () => {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-test')
  window.localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({
      id: 'u_seed_1',
      email: 'a',
      full_name: 'a',
      role: 'admin',
      consent_given_at: null,
      created_at: '',
    }),
  )
}

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
    // getSession real exige token + sessão.
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-test')
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        id: 'u_seed_1',
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

// A sessão pode morrer com a tela já montada (401 do apiFetch derruba tudo).
// Sem o AuthProvider reagindo, o `user` stale mantinha a tela protegida no ar e
// o /login inalcançável — o usuário ficava sem caminho nenhum pra sair.
describe('guards depois da sessão expirar com a tela montada', () => {
  beforeEach(() => window.localStorage.clear())

  it('RequireAuth manda pro login quando a sessão cai', async () => {
    seedAuthed()
    renderTree(['/protected'])
    await waitFor(() => expect(screen.getByTestId('protected')).toBeInTheDocument())

    await act(async () => {
      clearSession()
    })

    await waitFor(() => expect(screen.getByTestId('login-stub')).toBeInTheDocument())
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument()
  })

  it('GuestOnly deixa entrar depois que a sessão cai', async () => {
    seedAuthed()
    // Autenticado, o GuestOnly rebate /guest pra / — é o que prendia o usuário.
    renderTree(['/guest'])
    await waitFor(() => expect(screen.getByTestId('home-stub')).toBeInTheDocument())

    await act(async () => {
      clearSession()
    })

    // Sem sessão o / cai no RequireAuth, que manda pro login.
    await waitFor(() => expect(screen.getByTestId('login-stub')).toBeInTheDocument())
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
    // getSession real exige token + sessão.
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-test')
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        id: 'u_seed_1',
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
