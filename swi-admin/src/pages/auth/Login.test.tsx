import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AuthProvider } from '@/hooks/useAuth'
import { Login } from './Login'

const renderAt = (path = '/login', state?: object) =>
  render(
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
  )

beforeEach(() => window.localStorage.clear())

describe('Login', () => {
  it('shows email and password fields and a submit button', async () => {
    renderAt()
    expect(screen.getByLabelText(/^login$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^senha$/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^entrar$/i })).toBeInTheDocument()
  })

  it('shows validation error for invalid email', async () => {
    renderAt()
    fireEvent.change(screen.getByLabelText(/^login$/i), { target: { value: 'not-an-email' } })
    fireEvent.change(screen.getByLabelText(/^senha$/i), { target: { value: 'demo1234' } })
    fireEvent.click(screen.getByRole('button', { name: /^entrar$/i }))
    await waitFor(() => {
      expect(screen.getByTestId('form-error')).toHaveTextContent(/e-?mail/i)
    })
  })

  it('shows error from mockApi on invalid credentials', async () => {
    renderAt()
    fireEvent.change(screen.getByLabelText(/^login$/i), { target: { value: 'admin@swi.test' } })
    fireEvent.change(screen.getByLabelText(/^senha$/i), { target: { value: 'wrongpw1' } })
    fireEvent.click(screen.getByRole('button', { name: /^entrar$/i }))
    await waitFor(() => {
      expect(screen.getByTestId('form-error')).toHaveTextContent(/invalid/i)
    })
  })

  it('navigates to / on successful sign-in', async () => {
    renderAt()
    fireEvent.change(screen.getByLabelText(/^login$/i), { target: { value: 'admin@swi.test' } })
    fireEvent.change(screen.getByLabelText(/^senha$/i), { target: { value: 'demo1234' } })
    fireEvent.click(screen.getByRole('button', { name: /^entrar$/i }))
    await waitFor(() => {
      expect(screen.getByTestId('home')).toBeInTheDocument()
    })
  })

  it('navigates to state.from on successful sign-in if present', async () => {
    renderAt('/login', { from: '/employees' })
    fireEvent.change(screen.getByLabelText(/^login$/i), { target: { value: 'admin@swi.test' } })
    fireEvent.change(screen.getByLabelText(/^senha$/i), { target: { value: 'demo1234' } })
    fireEvent.click(screen.getByRole('button', { name: /^entrar$/i }))
    await waitFor(() => {
      expect(screen.getByTestId('employees')).toBeInTheDocument()
    })
  })
})
