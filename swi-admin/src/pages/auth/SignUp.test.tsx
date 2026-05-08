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
            <Route path="/login" element={<div data-testid="login" />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </SwiThemeProvider>,
  )

beforeEach(() => window.localStorage.clear())

type FillData = {
  companyName: string
  cnpj: string
  site: string
  cep: string
  street: string
  number: string
  neighborhood: string
  uf: string
  responsibleName: string
  phone: string
  email: string
  role: 'Dono/Fundador' | 'Sócio' | 'Gestor' | 'Segurança do trabalho' | ''
}

const defaults = (): FillData => ({
  companyName: 'Acme S.A.',
  cnpj: '12.345.678/0001-90',
  site: 'www.acme.com.br',
  cep: '30140-000',
  street: 'Avenida Quatro de Julho',
  number: '123',
  neighborhood: 'Pampulha',
  uf: 'MG',
  responsibleName: 'Maria da Silva',
  phone: '(31) 99999-0000',
  email: `unique${Date.now()}${Math.floor(Math.random() * 1e6)}@swi.test`,
  role: 'Dono/Fundador',
})

const fillValid = (overrides: Partial<FillData> = {}) => {
  const data: FillData = { ...defaults(), ...overrides }
  fireEvent.change(screen.getByLabelText(/^nome da empresa$/i), {
    target: { value: data.companyName },
  })
  fireEvent.change(screen.getByLabelText(/^cnpj$/i), { target: { value: data.cnpj } })
  fireEvent.change(screen.getByLabelText(/^site$/i), { target: { value: data.site } })
  fireEvent.change(screen.getByLabelText(/^cep$/i), { target: { value: data.cep } })
  fireEvent.change(screen.getByLabelText(/^logradouro$/i), { target: { value: data.street } })
  fireEvent.change(screen.getByLabelText(/^número$/i), { target: { value: data.number } })
  fireEvent.change(screen.getByLabelText(/^bairro$/i), { target: { value: data.neighborhood } })
  fireEvent.change(screen.getByLabelText(/^uf$/i), { target: { value: data.uf } })
  fireEvent.change(screen.getByLabelText(/^nome$/i), { target: { value: data.responsibleName } })
  fireEvent.change(screen.getByLabelText(/^telefone$/i), { target: { value: data.phone } })
  fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: data.email } })
  if (data.role) {
    fireEvent.click(screen.getByLabelText(new RegExp(data.role, 'i')))
  }
}

describe('SignUp', () => {
  it('renders all 3 sections, 11 inputs, 4 role radios and 2 action buttons', () => {
    renderAt()
    // Section headers
    expect(screen.getByText(/dados da empresa/i)).toBeInTheDocument()
    expect(screen.getByText(/dados do endereço/i)).toBeInTheDocument()
    expect(screen.getByText(/dados do responsável/i)).toBeInTheDocument()

    // 11 inputs (by accessible label)
    expect(screen.getByLabelText(/^nome da empresa$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^cnpj$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^site$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^cep$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^logradouro$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^número$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^bairro$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^uf$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^nome$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^telefone$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument()

    // 4 radios
    expect(screen.getByLabelText(/dono\/fundador/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^sócio$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^gestor$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/segurança do trabalho/i)).toBeInTheDocument()

    // 2 action buttons
    expect(screen.getByRole('button', { name: /voltar/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /finalizar/i })).toBeInTheDocument()
  })

  it('blocks submit with empty company name', async () => {
    renderAt()
    fillValid({ companyName: '' })
    fireEvent.click(screen.getByRole('button', { name: /finalizar/i }))
    await waitFor(() => {
      expect(screen.getByTestId('form-error')).toHaveTextContent(/empresa/i)
    })
  })

  it('blocks submit with invalid responsible email', async () => {
    renderAt()
    fillValid({ email: 'not-an-email' })
    fireEvent.click(screen.getByRole('button', { name: /finalizar/i }))
    await waitFor(() => {
      expect(screen.getByTestId('form-error')).toHaveTextContent(/e-?mail/i)
    })
  })

  it('blocks submit when no role is selected', async () => {
    renderAt()
    fillValid({ role: '' })
    fireEvent.click(screen.getByRole('button', { name: /finalizar/i }))
    await waitFor(() => {
      expect(screen.getByTestId('form-error')).toHaveTextContent(/função/i)
    })
  })

  it('navigates to / on successful submission', async () => {
    renderAt()
    fillValid()
    fireEvent.click(screen.getByRole('button', { name: /finalizar/i }))
    await waitFor(() => {
      expect(screen.getByTestId('home')).toBeInTheDocument()
    })
  })
})
