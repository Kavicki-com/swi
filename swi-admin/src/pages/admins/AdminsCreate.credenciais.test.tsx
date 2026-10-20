// Aviso depois do cadastro: o backend diz se o e-mail com as credenciais saiu,
// e o toast repete isso para o admin. O useDemoToast é substituído porque o
// renderPage não monta o provider do toast, e fora dele o show é inerte.
// describe/it/expect vêm dos globals do Vitest.
import { vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderPage, clearSession } from '@/test-utils/renderPage'
import { employeesApi } from '@/services/api/users'
import { AdminsCreate } from './AdminsCreate'

const { show } = vi.hoisted(() => ({ show: vi.fn() }))
vi.mock('@/lib/demoToast', () => ({ useDemoToast: () => ({ show }) }))

afterEach(() => {
  vi.restoreAllMocks()
  show.mockClear()
  clearSession()
})

function cadastrar() {
  fireEvent.change(screen.getByTestId('admins-create-nome'), { target: { value: 'Zé da Silva' } })
  fireEvent.change(screen.getByTestId('admins-create-email'), { target: { value: 'ze@x.com' } })
  fireEvent.change(screen.getByTestId('admins-create-senha'), { target: { value: 'Senha@123' } })
  fireEvent.click(screen.getByRole('button', { name: /finalizar cadastro/i }))
}

async function cadastrarCom(resposta: Record<string, unknown>) {
  vi.spyOn(employeesApi, 'create').mockResolvedValue({ data: resposta as never, error: null })
  const onBack = vi.fn()
  await renderPage(<AdminsCreate subject="funcionário" onBack={onBack} />)
  cadastrar()
  await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1))
}

describe('AdminsCreate: aviso do e-mail de credenciais', () => {
  it('e-mail enviado: o aviso diz que a pessoa recebeu as credenciais', async () => {
    await cadastrarCom({ id: 'n', credentialsEmailSent: true })
    expect(show).toHaveBeenCalledWith(
      'Cadastro concluído',
      'Zé da Silva foi cadastrado e recebeu as credenciais por e-mail',
    )
  })

  it('e-mail não enviado: o cadastro fica de pé e o aviso pede para passar as credenciais por outro meio', async () => {
    await cadastrarCom({ id: 'n', credentialsEmailSent: false })
    expect(show).toHaveBeenCalledWith(
      'Cadastro concluído',
      expect.stringContaining('não pôde ser enviado. Passe o login e a senha por outro meio.'),
    )
  })

  it('backend sem a informação: fica o aviso de sempre', async () => {
    await cadastrarCom({ id: 'n' })
    expect(show).toHaveBeenCalledWith(
      'Cadastro concluído',
      'Zé da Silva foi cadastrado com sucesso',
    )
  })
})
