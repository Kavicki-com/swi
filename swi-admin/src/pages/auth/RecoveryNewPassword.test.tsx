import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { RecoveryNewPassword } from './RecoveryNewPassword'

// O link do e-mail carrega email + código (não mais ?token=).
const renderAt = (url = '/recovery/new-password?email=maria%40acme.com&code=123456') =>
  render(
    <SwiThemeProvider>
      <MemoryRouter initialEntries={[url]}>
        <RecoveryNewPassword />
      </MemoryRouter>
    </SwiThemeProvider>,
  )

afterEach(() => vi.unstubAllGlobals())

describe('RecoveryNewPassword', () => {
  it('renders both password fields', () => {
    renderAt()
    expect(screen.getByTestId('recovery-newpassword-page')).toBeInTheDocument()
    expect(screen.getByLabelText(/^nova senha$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/confirmar/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /alterar senha/i })).toBeInTheDocument()
  })

  it('rejects mismatched passwords', async () => {
    renderAt()
    fireEvent.change(screen.getByLabelText(/^nova senha$/i), { target: { value: 'novo1234' } })
    fireEvent.change(screen.getByLabelText(/confirmar/i), { target: { value: 'different1' } })
    fireEvent.click(screen.getByRole('button', { name: /alterar senha/i }))
    await waitFor(() => {
      expect(screen.getByTestId('form-error')).toHaveTextContent(/coincid/i)
    })
  })

  it('shows the matching helper when both passwords are equal and non-empty', async () => {
    renderAt()
    fireEvent.change(screen.getByLabelText(/^nova senha$/i), { target: { value: 'novo1234' } })
    fireEvent.change(screen.getByLabelText(/confirmar/i), { target: { value: 'novo1234' } })
    await waitFor(() => {
      expect(screen.getByTestId('passwords-match')).toBeInTheDocument()
    })
  })

  it('barra o submit quando o link não traz email/código', async () => {
    renderAt('/recovery/new-password') // sem query = link inválido
    fireEvent.change(screen.getByLabelText(/^nova senha$/i), { target: { value: 'novo1234' } })
    fireEvent.change(screen.getByLabelText(/confirmar/i), { target: { value: 'novo1234' } })
    fireEvent.click(screen.getByRole('button', { name: /alterar senha/i }))
    await waitFor(() => {
      expect(screen.getByTestId('form-error')).toHaveTextContent(/inválido/i)
    })
  })

  it('shows the success panel after a valid reset (POST /auth/password/reset)', async () => {
    const f = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => null } as Response)
    vi.stubGlobal('fetch', f)

    renderAt()
    fireEvent.change(screen.getByLabelText(/^nova senha$/i), { target: { value: 'novo1234' } })
    fireEvent.change(screen.getByLabelText(/confirmar/i), { target: { value: 'novo1234' } })
    fireEvent.click(screen.getByRole('button', { name: /alterar senha/i }))
    await waitFor(() => {
      expect(screen.getByTestId('recovery-newpassword-sent')).toBeInTheDocument()
    })
    // manda email + code do link + a nova senha
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/auth/password/reset')
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'maria@acme.com',
      code: '123456',
      newPassword: 'novo1234',
    })
    const loginLink = screen.getByRole('link', { name: /voltar/i })
    expect(loginLink).toHaveAttribute('href', '/login')
  })
})
