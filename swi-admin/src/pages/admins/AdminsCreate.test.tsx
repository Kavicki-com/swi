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
  it('sem obrigatórios não chama a api', () => {
    const create = vi.spyOn(employeesApi, 'create')
    renderPage(<AdminsCreate subject="funcionário" onBack={vi.fn()} />)

    finalizar()

    expect(create).not.toHaveBeenCalled()
  })

  it('submit válido chama create com a identidade mapeada (sem campos de saúde)', async () => {
    const create = vi
      .spyOn(employeesApi, 'create')
      .mockResolvedValue({ data: { id: 'n' } as never, error: null })
    renderPage(<AdminsCreate subject="funcionário" onBack={vi.fn()} />)

    typeIn('admins-create-nome', 'Zé da Silva')
    typeIn('admins-create-email', 'ze@x.com')
    typeIn('admins-create-telefone', '11999999999')
    typeIn('admins-create-senha', 'senha123')

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

  it('admin usa adminsApi.create', async () => {
    const create = vi
      .spyOn(adminsApi, 'create')
      .mockResolvedValue({ data: { id: 'n' } as never, error: null })
    renderPage(<AdminsCreate onBack={vi.fn()} />)

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
    renderPage(<AdminsCreate subject="funcionário" onBack={onBack} />)

    typeIn('admins-create-nome', 'Zé da Silva')
    typeIn('admins-create-email', 'ze@x.com')
    typeIn('admins-create-senha', 'senha123')

    finalizar()

    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1))
  })
})
