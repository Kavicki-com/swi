import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { RecoveryEmail } from './RecoveryEmail'

const renderAt = () =>
  render(
    <SwiThemeProvider>
      <MemoryRouter initialEntries={['/recovery/email']}>
        <RecoveryEmail />
      </MemoryRouter>
    </SwiThemeProvider>,
  )

// O backend responde 200 silencioso (não vaza se o e-mail existe); qualquer
// 200 leva ao painel de confirmação.
const stubOk = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => null } as Response),
  )

afterEach(() => vi.unstubAllGlobals())

describe('RecoveryEmail', () => {
  it('renders email field and submit button', () => {
    renderAt()
    expect(screen.getByLabelText(/e-?mail/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /enviar link/i })).toBeInTheDocument()
  })

  it('shows error on invalid email', async () => {
    renderAt()
    fireEvent.change(screen.getByLabelText(/e-?mail/i), { target: { value: 'not-an-email' } })
    fireEvent.click(screen.getByRole('button', { name: /enviar link/i }))
    await waitFor(() => {
      expect(screen.getByTestId('form-error')).toHaveTextContent(/e-?mail/i)
    })
  })

  it('swaps to confirmation panel on valid email (POST /auth/password/forgot-admin)', async () => {
    const f = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => null } as Response)
    vi.stubGlobal('fetch', f)
    renderAt()
    fireEvent.change(screen.getByLabelText(/e-?mail/i), { target: { value: 'whatever@swi.test' } })
    fireEvent.click(screen.getByRole('button', { name: /enviar link/i }))
    await waitFor(() => {
      expect(screen.getByTestId('recovery-email-sent')).toBeInTheDocument()
    })
    expect(screen.getByText(/caixa de entrada/i)).toBeInTheDocument()
    expect((f.mock.calls[0] as [string, RequestInit])[0]).toContain('/auth/password/forgot-admin')
  })

  it('confirmation panel has a link to /login', async () => {
    stubOk()
    renderAt()
    fireEvent.change(screen.getByLabelText(/e-?mail/i), { target: { value: 'whatever@swi.test' } })
    fireEvent.click(screen.getByRole('button', { name: /enviar link/i }))
    await waitFor(() => {
      expect(screen.getByTestId('recovery-email-sent')).toBeInTheDocument()
    })
    const loginLink = screen.getByRole('link', { name: /voltar/i })
    expect(loginLink).toHaveAttribute('href', '/login')
  })
})
