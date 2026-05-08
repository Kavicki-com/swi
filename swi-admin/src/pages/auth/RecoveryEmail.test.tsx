import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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

describe('RecoveryEmail', () => {
  it('renders email field and submit button', () => {
    renderAt()
    expect(screen.getByLabelText(/e-?mail/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /enviar instru/i })).toBeInTheDocument()
  })

  it('shows error on invalid email', async () => {
    renderAt()
    fireEvent.change(screen.getByLabelText(/e-?mail/i), { target: { value: 'not-an-email' } })
    fireEvent.click(screen.getByRole('button', { name: /enviar instru/i }))
    await waitFor(() => {
      expect(screen.getByTestId('form-error')).toHaveTextContent(/e-?mail/i)
    })
  })

  it('swaps to confirmation panel on valid email', async () => {
    renderAt()
    fireEvent.change(screen.getByLabelText(/e-?mail/i), { target: { value: 'whatever@swi.test' } })
    fireEvent.click(screen.getByRole('button', { name: /enviar instru/i }))
    await waitFor(() => {
      expect(screen.getByTestId('recovery-email-sent')).toBeInTheDocument()
    })
    expect(screen.getByText(/caixa de entrada/i)).toBeInTheDocument()
  })

  it('confirmation panel has a link to /login', async () => {
    renderAt()
    fireEvent.change(screen.getByLabelText(/e-?mail/i), { target: { value: 'whatever@swi.test' } })
    fireEvent.click(screen.getByRole('button', { name: /enviar instru/i }))
    await waitFor(() => {
      expect(screen.getByTestId('recovery-email-sent')).toBeInTheDocument()
    })
    const loginLink = screen.getByRole('link', { name: /voltar/i })
    expect(loginLink).toHaveAttribute('href', '/login')
  })
})
