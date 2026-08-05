// Comportamento do formulário compartilhado de cadastro (AdminsCreate serve
// tanto /admins quanto /employees). Prova: validação de obrigatórios, forma do
// payload (só identidade — nada de saúde/username) e o onBack no sucesso.
// describe/it/expect/beforeEach vêm dos globals do Vitest.
import { vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderPage, clearSession } from '@/test-utils/renderPage'
import { employeesApi, adminsApi } from '@/services/api/users'
import { AdminsCreate } from './AdminsCreate'

afterEach(() => {
  vi.restoreAllMocks()
  clearSession()
})

function typeIn(testID: string, value: string) {
  fireEvent.change(screen.getByTestId(testID), { target: { value } })
}

function finalizar() {
  fireEvent.click(screen.getByRole('button', { name: /finalizar cadastro/i }))
}

describe('AdminsCreate — submit', () => {
  it('sem obrigatórios não chama a api', async () => {
    const create = vi.spyOn(employeesApi, 'create')
    await renderPage(<AdminsCreate subject="funcionário" onBack={vi.fn()} />)

    finalizar()

    expect(create).not.toHaveBeenCalled()
  })

  it('submit válido chama create com a identidade mapeada (sem campos de saúde)', async () => {
    const create = vi
      .spyOn(employeesApi, 'create')
      .mockResolvedValue({ data: { id: 'n' } as never, error: null })
    await renderPage(<AdminsCreate subject="funcionário" onBack={vi.fn()} />)

    typeIn('admins-create-nome', 'Zé da Silva')
    typeIn('admins-create-email', 'ze@x.com')
    typeIn('admins-create-telefone', '11999999999')
    typeIn('admins-create-senha', 'senha123')
    // Preenche o nome de usuário (campo de UI que NÃO deve subir): prova que um
    // campo PREENCHIDO fora da identidade não vaza pro payload, não só um vazio.
    typeIn('admins-create-usuario', 'zedasilva')

    finalizar()

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    const payload = create.mock.calls[0]?.[0]
    expect(payload).toEqual({
      name: 'Zé da Silva',
      email: 'ze@x.com',
      password: 'senha123',
      phone: '11999999999',
    })
    // Nada de saúde/username no corpo — esses campos ficam na UI mas não sobem.
    expect(payload).not.toHaveProperty('tipoSanguineo')
    expect(payload).not.toHaveProperty('genero')
    expect(payload).not.toHaveProperty('nomeUsuario')
  })

  it('e-mail inválido não chama create e mostra erro', async () => {
    const create = vi.spyOn(employeesApi, 'create')
    await renderPage(<AdminsCreate subject="funcionário" onBack={vi.fn()} />)

    typeIn('admins-create-nome', 'Zé da Silva')
    typeIn('admins-create-email', 'abc')
    typeIn('admins-create-senha', 'senha123')

    finalizar()

    expect(create).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/e-mail válido/i)
  })

  it('senha com menos de 8 caracteres não chama create', async () => {
    const create = vi.spyOn(employeesApi, 'create')
    await renderPage(<AdminsCreate subject="funcionário" onBack={vi.fn()} />)

    typeIn('admins-create-nome', 'Zé da Silva')
    typeIn('admins-create-email', 'ze@x.com')
    typeIn('admins-create-senha', 'sete123')

    finalizar()

    expect(create).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/8 caracteres/i)
  })

  it('admin usa adminsApi.create', async () => {
    const create = vi
      .spyOn(adminsApi, 'create')
      .mockResolvedValue({ data: { id: 'n' } as never, error: null })
    await renderPage(<AdminsCreate onBack={vi.fn()} />)

    typeIn('admins-create-nome', 'Ana Admin')
    typeIn('admins-create-email', 'ana@x.com')
    typeIn('admins-create-senha', 'senha123')

    finalizar()

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
  })

  it('sucesso chama onBack', async () => {
    vi.spyOn(employeesApi, 'create').mockResolvedValue({
      data: { id: 'n' } as never,
      error: null,
    })
    const onBack = vi.fn()
    await renderPage(<AdminsCreate subject="funcionário" onBack={onBack} />)

    typeIn('admins-create-nome', 'Zé da Silva')
    typeIn('admins-create-email', 'ze@x.com')
    typeIn('admins-create-senha', 'senha123')

    finalizar()

    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1))
  })
})
