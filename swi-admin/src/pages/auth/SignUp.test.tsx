import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AuthProvider } from '@/hooks/useAuth'
import { SignUp } from './SignUp'

const renderAt = () =>
  render(
    <SwiThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={['/sign-up']}>
          <Routes>
            <Route path="/sign-up" element={<SignUp />} />
            <Route path="/" element={<div data-testid="home" />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </SwiThemeProvider>,
  )

beforeEach(() => window.localStorage.clear())

const fillValid = (
  overrides: Partial<{
    full_name: string
    email: string
    password: string
    confirm: string
    consent: boolean
  }> = {},
) => {
  const data = {
    full_name: 'Novo Usuario',
    email: 'novo@swi.test',
    password: 'novo1234',
    confirm: 'novo1234',
    consent: true,
    ...overrides,
  }
  fireEvent.change(screen.getByLabelText(/nome/i), { target: { value: data.full_name } })
  fireEvent.change(screen.getByLabelText(/e-?mail/i), { target: { value: data.email } })
  fireEvent.change(screen.getByLabelText(/^senha$/i), { target: { value: data.password } })
  fireEvent.change(screen.getByLabelText(/confirmar/i), { target: { value: data.confirm } })
  if (data.consent) {
    fireEvent.click(screen.getByLabelText(/aceito/i))
  }
}

describe('SignUp', () => {
  it('renders all 5 inputs and submit button', () => {
    renderAt()
    expect(screen.getByLabelText(/nome/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/e-?mail/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^senha$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/confirmar/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/aceito/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /criar conta/i })).toBeInTheDocument()
  })

  it('blocks submit with empty full_name', async () => {
    renderAt()
    fillValid({ full_name: '' })
    fireEvent.click(screen.getByRole('button', { name: /criar conta/i }))
    await waitFor(() => {
      expect(screen.getByTestId('form-error')).toHaveTextContent(/nome/i)
    })
  })

  it('blocks submit with mismatched passwords', async () => {
    renderAt()
    fillValid({ confirm: 'different1' })
    fireEvent.click(screen.getByRole('button', { name: /criar conta/i }))
    await waitFor(() => {
      expect(screen.getByTestId('form-error')).toHaveTextContent(/coincid/i)
    })
  })

  it('blocks submit without consent', async () => {
    renderAt()
    fillValid({ consent: false })
    fireEvent.click(screen.getByRole('button', { name: /criar conta/i }))
    await waitFor(() => {
      expect(screen.getByTestId('form-error')).toHaveTextContent(/privacidade/i)
    })
  })

  it('surfaces mockApi error when email is already registered', async () => {
    renderAt()
    fillValid({ email: 'admin@swi.test' })
    fireEvent.click(screen.getByRole('button', { name: /criar conta/i }))
    await waitFor(() => {
      expect(screen.getByTestId('form-error')).toHaveTextContent(/already/i)
    })
  })

  it('navigates to / on successful sign-up', async () => {
    renderAt()
    fillValid({ email: `unique${Date.now()}@swi.test` })
    fireEvent.click(screen.getByRole('button', { name: /criar conta/i }))
    await waitFor(() => {
      expect(screen.getByTestId('home')).toBeInTheDocument()
    })
  })
})
