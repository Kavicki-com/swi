import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { RecoveryNewPassword } from './RecoveryNewPassword'

const renderAt = (url = '/recovery/new-password?token=tok123') =>
  render(
    <SwiThemeProvider>
      <MemoryRouter initialEntries={[url]}>
        <RecoveryNewPassword />
      </MemoryRouter>
    </SwiThemeProvider>,
  )

describe('RecoveryNewPassword', () => {
  it('renders both password fields when token is present', () => {
    renderAt()
    expect(screen.getByTestId('recovery-newpassword-page')).toBeInTheDocument()
    expect(screen.getByLabelText(/^nova senha$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/confirmar/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /alterar senha/i })).toBeInTheDocument()
  })

  it('rejects mismatched passwords', async () => {
    renderAt()
    fireEvent.change(screen.getByLabelText(/^nova senha$/i), {
      target: { value: 'novo1234' },
    })
    fireEvent.change(screen.getByLabelText(/confirmar/i), {
      target: { value: 'different1' },
    })
    fireEvent.click(screen.getByRole('button', { name: /alterar senha/i }))
    await waitFor(() => {
      expect(screen.getByTestId('form-error')).toHaveTextContent(/coincid/i)
    })
  })

  it('shows the matching helper when both passwords are equal and non-empty', async () => {
    renderAt()
    fireEvent.change(screen.getByLabelText(/^nova senha$/i), {
      target: { value: 'novo1234' },
    })
    fireEvent.change(screen.getByLabelText(/confirmar/i), {
      target: { value: 'novo1234' },
    })
    await waitFor(() => {
      expect(screen.getByTestId('passwords-match')).toBeInTheDocument()
    })
  })

  it('shows the success panel after a valid reset', async () => {
    renderAt()
    fireEvent.change(screen.getByLabelText(/^nova senha$/i), {
      target: { value: 'novo1234' },
    })
    fireEvent.change(screen.getByLabelText(/confirmar/i), {
      target: { value: 'novo1234' },
    })
    fireEvent.click(screen.getByRole('button', { name: /alterar senha/i }))
    await waitFor(() => {
      expect(screen.getByTestId('recovery-newpassword-sent')).toBeInTheDocument()
    })
    const loginLink = screen.getByRole('link', { name: /voltar/i })
    expect(loginLink).toHaveAttribute('href', '/login')
  })
})
