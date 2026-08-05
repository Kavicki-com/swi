// describe/it/expect/beforeEach vêm dos globals do Vitest.
import { vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AuthProvider } from '@/hooks/useAuth'
import { Login } from './Login'
import { settled } from '@/test-utils/renderPage'

// Teste de UI: o serviço de auth (real, backend Nest) é mockado inteiro pra
// não depender de rede — o contrato dele já é coberto em services/api/auth.test.ts.
const { signInMock } = vi.hoisted(() => ({ signInMock: vi.fn() }))
vi.mock('@/services/auth', () => ({
  authApi: {
    signIn: signInMock,
    getSession: vi.fn(async () => ({ data: null, error: null })),
    signOut: vi.fn(async () => ({ data: null, error: null })),
  },
}))

const adminUser = {
  id: 'u1',
  email: 'admin@swi.local',
  full_name: 'Admin Demo',
  role: 'admin',
  consent_given_at: null,
  created_at: new Date().toISOString(),
}

const renderAt = async (path = '/login', state?: object) =>
  settled(render(
    <SwiThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={[{ pathname: path, state }]}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<div data-testid="home" />} />
            <Route path="/employees" element={<div data-testid="employees" />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </SwiThemeProvider>,
  ))

beforeEach(() => {
  window.localStorage.clear()
  signInMock.mockReset()
})

describe('Login', () => {
  it('shows email and password fields and a submit button', async () => {
    await renderAt()
    expect(screen.getByLabelText(/^login$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^senha$/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^entrar$/i })).toBeInTheDocument()
  })

  it('does not offer a demo login anymore', async () => {
    await renderAt()
    expect(screen.queryByRole('button', { name: /demo/i })).not.toBeInTheDocument()
  })

  it('shows validation error for invalid email', async () => {
    await renderAt()
    fireEvent.change(screen.getByLabelText(/^login$/i), { target: { value: 'not-an-email' } })
    fireEvent.change(screen.getByLabelText(/^senha$/i), { target: { value: 'demo1234' } })
    fireEvent.click(screen.getByRole('button', { name: /^entrar$/i }))
    await waitFor(() => {
      expect(screen.getByTestId('form-error')).toHaveTextContent(/e-?mail/i)
    })
    expect(signInMock).not.toHaveBeenCalled()
  })

  it('shows the backend error message on invalid credentials', async () => {
    signInMock.mockResolvedValue({ data: null, error: { message: 'Credenciais inválidas' } })
    await renderAt()
    fireEvent.change(screen.getByLabelText(/^login$/i), { target: { value: 'admin@swi.local' } })
    fireEvent.change(screen.getByLabelText(/^senha$/i), { target: { value: 'wrongpw1' } })
    fireEvent.click(screen.getByRole('button', { name: /^entrar$/i }))
    await waitFor(() => {
      expect(screen.getByTestId('form-error')).toHaveTextContent('Credenciais inválidas')
    })
  })

  it('navigates to / on successful sign-in', async () => {
    signInMock.mockResolvedValue({ data: adminUser, error: null })
    await renderAt()
    fireEvent.change(screen.getByLabelText(/^login$/i), { target: { value: 'admin@swi.local' } })
    fireEvent.change(screen.getByLabelText(/^senha$/i), { target: { value: 'admin123' } })
    fireEvent.click(screen.getByRole('button', { name: /^entrar$/i }))
    await waitFor(() => {
      expect(screen.getByTestId('home')).toBeInTheDocument()
    })
    expect(signInMock).toHaveBeenCalledWith({ email: 'admin@swi.local', password: 'admin123' })
  })

  it('navigates to state.from on successful sign-in if present', async () => {
    signInMock.mockResolvedValue({ data: adminUser, error: null })
    await renderAt('/login', { from: '/employees' })
    fireEvent.change(screen.getByLabelText(/^login$/i), { target: { value: 'admin@swi.local' } })
    fireEvent.change(screen.getByLabelText(/^senha$/i), { target: { value: 'admin123' } })
    fireEvent.click(screen.getByRole('button', { name: /^entrar$/i }))
    await waitFor(() => {
      expect(screen.getByTestId('employees')).toBeInTheDocument()
    })
  })
})
